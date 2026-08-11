import type {
  TicketAssignInput,
  TicketCancelInput,
  TicketCommentCreateInput,
  TicketCreateInput,
  TicketPriorityCode,
  TicketQuery,
  TicketResolveInput,
  TicketScope,
  TicketStatusCode,
  TicketWaitInput,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { dateKeyOf } from '../../common/utils/calendar';
import { searchWhere, toPaginated } from '../../common/utils/list-query';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { assertWorksTheDesk } from './helpdesk.agents';
import { mapTicket, type TicketViewer } from './helpdesk.mapper';
import { mayAct, nextStatus, type TicketAction, ticketError } from './helpdesk.rules';
import { TicketCategoriesService } from './ticket-categories.service';

const PERSON = {
  select: { id: true, firstName: true, lastName: true, employeeCode: true },
} as const;

const LIST_INCLUDE = {
  category: { select: { id: true, name: true } },
  requester: PERSON,
  assignee: PERSON,
} as const satisfies Prisma.TicketInclude;

const DETAIL_INCLUDE = {
  ...LIST_INCLUDE,
  comments: {
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { id: true, email: true, employee: PERSON } } },
  },
} as const satisfies Prisma.TicketInclude;

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: TicketCategoriesService,
    private readonly notifications: NotificationsService,
  ) {}

  private requireEmployee(claims: AccessTokenClaims): string {
    if (!claims.employeeId) {
      throw new BadRequestException('No employee record is linked to this account');
    }
    return claims.employeeId;
  }

  /**
   * Which tickets this token may see.
   *
   * `'__none__'` for somebody with no employee record is the sentinel every
   * other scoped list in this codebase uses: it matches nothing, where an
   * `undefined` would have silently matched the whole company.
   *
   * Asking for a wider scope than you hold **narrows** rather than refusing,
   * which is what `expenses.service.ts` and the performance module already do
   * and what `rbac.e2e-spec.ts` pins as intended. It is tempting to 403 here
   * instead — an answer to a narrower question than the one asked is arguably
   * dishonest — but the same request returning 200-with-your-rows in four
   * modules and 403 in a fifth is worse. The convention is the convention.
   */
  private scopeWhere(claims: AccessTokenClaims, scope: TicketScope): Prisma.TicketWhereInput {
    const perms = new Set(claims.perms);
    const me = claims.employeeId ?? '__none__';

    if (scope === 'all' && perms.has('helpdesk.read')) return {};
    if (scope === 'queue' && perms.has('helpdesk.respond')) {
      /* The queue is mine plus nobody's — not everyone's. Reading a ticket
         assigned to somebody else is `helpdesk.read`, a different grant. */
      return { OR: [{ assigneeId: me }, { assigneeId: null }] };
    }
    return { requesterId: me };
  }

  /** Agent *on this ticket* — holding the code is not enough if it is your own. */
  private viewer(claims: AccessTokenClaims, requesterId: string): TicketViewer {
    const isAgent =
      new Set(claims.perms).has('helpdesk.respond') && claims.employeeId !== requesterId;
    return { employeeId: claims.employeeId ?? null, isAgent };
  }

  /**
   * How far this token can reach, folded into the `where` rather than checked
   * after the read — so an unreachable ticket comes back as nothing found.
   *
   * That is what makes both reads below a **404 and not a 403**. Whether a
   * ticket exists is itself information: a helpdesk that answers "forbidden"
   * to a wrong guess and "not found" to a bad id is one you can probe for
   * whether a colleague has raised a grievance.
   */
  private reachWhere(claims: AccessTokenClaims, id: string): Prisma.TicketWhereInput {
    const perms = new Set(claims.perms);
    const me = claims.employeeId ?? '__none__';
    const base = { id, organizationId: claims.orgId };
    if (perms.has('helpdesk.read')) return base;

    const reach: Prisma.TicketWhereInput[] = [{ requesterId: me }];
    if (perms.has('helpdesk.respond')) reach.push({ assigneeId: me }, { assigneeId: null });
    return { ...base, OR: reach };
  }

  /** The row on its own — what the write paths need before they change it. */
  private async readable(claims: AccessTokenClaims, id: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: this.reachWhere(claims, id),
      include: LIST_INCLUDE,
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  /** The row and its thread, for the one read that renders it. */
  private async readableDetail(claims: AccessTokenClaims, id: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: this.reachWhere(claims, id),
      include: DETAIL_INCLUDE,
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  /**
   * Check the move and the mover together.
   *
   * Both halves matter and they fail differently: a status that does not permit
   * the action is a 400 explaining what state the ticket is in, and an actor
   * not allowed to take it is a 403 — a requester is not told that resolving
   * would have been valid if only they worked the desk.
   */
  private resolveNext(
    status: TicketStatusCode,
    action: TicketAction,
    viewer: TicketViewer,
    isRequester: boolean,
  ): TicketStatusCode {
    const actor = viewer.isAgent ? 'AGENT' : 'REQUESTER';
    if (!mayAct(action, actor)) {
      throw new ForbiddenException('That is not yours to do on this ticket');
    }
    if (actor === 'REQUESTER' && !isRequester) {
      throw new ForbiddenException('That is not yours to do on this ticket');
    }
    const next = nextStatus(status, action);
    if (next === null) throw new BadRequestException(ticketError(status, action));
    return next;
  }

  /** A terse entry on the thread — never the content of anything. */
  private systemComment(ticketId: string, body: string) {
    return this.prisma.ticketComment.create({
      data: { ticketId, kind: 'SYSTEM', body, authorId: null },
    });
  }

  /**
   * The users who work the desk, resolved through the role graph rather than by
   * role code — so an organization that composed its own agent role in Settings
   * is reached without anybody editing this file.
   *
   * Done here rather than through `notifyPermission` for one reason: that
   * helper always emails, and the case this exists for is the one where email
   * must be off.
   */
  private async deskUserIds(orgId: string, except?: string | null): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        organizationId: orgId,
        status: 'ACTIVE',
        role: { permissions: { some: { permission: { code: 'helpdesk.respond' } } } },
        ...(except ? { id: { not: except } } : {}),
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  private async userIdFor(employeeId: string | null): Promise<string[]> {
    if (!employeeId) return [];
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { userId: true },
    });
    return employee?.userId ? [employee.userId] : [];
  }

  private ctx(claims: AccessTokenClaims) {
    return { orgId: claims.orgId, userId: claims.sub };
  }

  // ── reads ───────────────────────────────────────────────────────────

  async list(claims: AccessTokenClaims, query: TicketQuery) {
    const where: Prisma.TicketWhereInput = {
      organizationId: claims.orgId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
      ...searchWhere(query.search, ['subject']),
      ...this.scopeWhere(claims, query.scope),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where,
        include: LIST_INCLUDE,
        /* Oldest first on the desk, newest first on your own. A queue is worked
           from the bottom; your own list is read from the top. */
        orderBy: query.scope === 'own' ? [{ createdAt: 'desc' }] : [{ createdAt: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.ticket.count({ where }),
    ]);
    const today = dateKeyOf(new Date());
    return toPaginated(
      rows.map((row) => mapTicket(row, this.viewer(claims, row.requesterId), today)),
      total,
      query,
    );
  }

  async get(claims: AccessTokenClaims, id: string) {
    const ticket = await this.readableDetail(claims, id);
    return mapTicket(ticket, this.viewer(claims, ticket.requesterId), dateKeyOf(new Date()));
  }

  /** The counts behind the tab badges, in the caller's own scopes. */
  async summary(claims: AccessTokenClaims) {
    const perms = new Set(claims.perms);
    const me = claims.employeeId ?? '__none__';
    const open: TicketStatusCode[] = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_REQUESTER'];

    const mine = await this.prisma.ticket.count({
      where: { organizationId: claims.orgId, requesterId: me, status: { in: open } },
    });
    if (!perms.has('helpdesk.respond')) return { mine, queue: 0, unassigned: 0 };

    const [queue, unassigned] = await this.prisma.$transaction([
      this.prisma.ticket.count({
        where: { organizationId: claims.orgId, assigneeId: me, status: { in: open } },
      }),
      this.prisma.ticket.count({
        where: { organizationId: claims.orgId, assigneeId: null, status: { in: open } },
      }),
    ]);
    return { mine, queue, unassigned };
  }

  // ── writes ──────────────────────────────────────────────────────────

  async create(claims: AccessTokenClaims, input: TicketCreateInput) {
    const requesterId = this.requireEmployee(claims);
    const category = await this.categories.requireActive(claims.orgId, input.categoryId);

    const ticket = await this.prisma.ticket.create({
      data: {
        organizationId: claims.orgId,
        categoryId: category.id,
        requesterId,
        /* Routing, such as it is: the category names who picks these up. */
        assigneeId: category.defaultAssigneeId,
        assignedAt: category.defaultAssigneeId ? new Date() : null,
        subject: input.subject,
        description: input.description,
      },
      include: DETAIL_INCLUDE,
    });

    await auditMutation(
      this.prisma,
      this.ctx(claims),
      'helpdesk.ticket.create',
      'Ticket',
      ticket.id,
      {
        after: { subject: ticket.subject, categoryId: category.id },
      },
    );

    /*
     * The body is the subject, never the description — see the note on
     * `comment` below. It is the same rule everywhere in this module.
     */
    const notice = {
      type: 'helpdesk.ticket.raised',
      title: 'New helpdesk ticket',
      body: ticket.subject,
      linkPath: `/helpdesk/${ticket.id}`,
    };
    if (category.defaultAssigneeId) {
      await this.notifications.notify(await this.userIdFor(category.defaultAssigneeId), notice);
    } else {
      await this.notifications.notifyPermission(claims.orgId, 'helpdesk.respond', notice, {
        except: claims.sub,
      });
    }

    return mapTicket(ticket, this.viewer(claims, ticket.requesterId), dateKeyOf(new Date()));
  }

  /**
   * A reply, or an internal note.
   *
   * `internal` is refused rather than quietly downgraded when the caller cannot
   * hold it. Silently turning a note into a public comment would put words the
   * author believed were private in front of the person they were about, which
   * is the worst thing this module could do.
   *
   * **No notification ever carries a comment body.** Every one of them sends
   * the ticket subject instead, which removes the whole class of internal-note
   * leaks rather than relying on each call site to remember.
   */
  async comment(claims: AccessTokenClaims, id: string, input: TicketCommentCreateInput) {
    const ticket = await this.readable(claims, id);
    const viewer = this.viewer(claims, ticket.requesterId);
    const isRequester = claims.employeeId === ticket.requesterId;

    if (input.internal && !viewer.isAgent) {
      throw new ForbiddenException('Only somebody working the helpdesk can leave an internal note');
    }

    const action: TicketAction = viewer.isAgent ? 'commentAsAgent' : 'commentAsRequester';
    const next = this.resolveNext(ticket.status, action, viewer, isRequester);

    await this.prisma.ticketComment.create({
      data: {
        ticketId: ticket.id,
        authorId: claims.sub,
        kind: input.internal ? 'INTERNAL' : 'PUBLIC',
        body: input.body,
      },
    });

    if (next !== ticket.status) {
      await this.prisma.ticket.update({ where: { id: ticket.id }, data: { status: next } });
      await this.systemComment(ticket.id, `Moved to ${next.replace(/_/g, ' ').toLowerCase()}`);
    }

    /* An internal note tells nobody. That is what makes it internal. */
    if (!input.internal) {
      const notice = {
        type: viewer.isAgent ? 'helpdesk.comment.agent' : 'helpdesk.comment.requester',
        title: viewer.isAgent ? 'A reply on your ticket' : 'A reply on a helpdesk ticket',
        body: ticket.subject,
        linkPath: `/helpdesk/${ticket.id}`,
      };
      if (viewer.isAgent) {
        /* The reply they have been waiting for — the most useful mail this
           module sends, so it goes out by email as well. */
        await this.notifications.notify(await this.userIdFor(ticket.requesterId), notice);
      } else {
        /*
         * Email off. An agent working a queue is already in the app, and one
         * message per reply on a chatty ticket is what teaches people to filter
         * the product's mail until they miss the one that mattered.
         */
        const recipients = ticket.assigneeId
          ? await this.userIdFor(ticket.assigneeId)
          : await this.deskUserIds(claims.orgId, claims.sub);
        await this.notifications.notify(recipients, notice, { email: false });
      }
    }

    return this.get(claims, ticket.id);
  }

  async assign(claims: AccessTokenClaims, id: string, input: TicketAssignInput) {
    const ticket = await this.readable(claims, id);
    const viewer = this.viewer(claims, ticket.requesterId);
    this.resolveNext(ticket.status, 'assign', viewer, claims.employeeId === ticket.requesterId);

    if (input.assigneeId) {
      await assertWorksTheDesk(
        this.prisma,
        claims.orgId,
        input.assigneeId,
        'That person does not work the helpdesk',
      );
    }

    const assignee = input.assigneeId
      ? await this.prisma.employee.findUnique({
          where: { id: input.assigneeId },
          select: { firstName: true, lastName: true },
        })
      : null;

    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        assigneeId: input.assigneeId,
        assignedAt: input.assigneeId ? new Date() : null,
      },
    });
    await this.systemComment(
      ticket.id,
      assignee ? `Assigned to ${assignee.firstName} ${assignee.lastName}` : 'Returned to the queue',
    );
    await auditMutation(
      this.prisma,
      this.ctx(claims),
      'helpdesk.ticket.assign',
      'Ticket',
      ticket.id,
      {
        before: { assigneeId: ticket.assigneeId },
        after: { assigneeId: input.assigneeId },
      },
    );

    /* Not when you picked it up yourself — you know. */
    if (input.assigneeId && input.assigneeId !== claims.employeeId) {
      await this.notifications.notify(await this.userIdFor(input.assigneeId), {
        type: 'helpdesk.ticket.assigned',
        title: 'A ticket was assigned to you',
        body: ticket.subject,
        linkPath: `/helpdesk/${ticket.id}`,
      });
    }
    return this.get(claims, ticket.id);
  }

  /** One shape for every plain status move, so they cannot drift apart. */
  private async transition(
    claims: AccessTokenClaims,
    id: string,
    action: TicketAction,
    extra: (next: TicketStatusCode) => Prisma.TicketUpdateInput,
    systemNote: string,
  ) {
    const ticket = await this.readable(claims, id);
    const viewer = this.viewer(claims, ticket.requesterId);
    const isRequester = claims.employeeId === ticket.requesterId;
    const next = this.resolveNext(ticket.status, action, viewer, isRequester);

    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: next, ...extra(next) },
    });
    await this.systemComment(ticket.id, systemNote);
    await auditMutation(
      this.prisma,
      this.ctx(claims),
      `helpdesk.ticket.${action}`,
      'Ticket',
      ticket.id,
      {
        before: { status: ticket.status },
        after: { status: next },
      },
    );
    return { ticket, next };
  }

  async start(claims: AccessTokenClaims, id: string) {
    const { ticket } = await this.transition(claims, id, 'start', () => ({}), 'Picked up');
    return this.get(claims, ticket.id);
  }

  async wait(claims: AccessTokenClaims, id: string, input: TicketWaitInput) {
    const { ticket } = await this.transition(
      claims,
      id,
      'waitOnRequester',
      () => ({}),
      'Waiting on the person who raised this',
    );
    /* The note is public and required: a status somebody cannot act on is not
       a status, it is a dead end with a label. */
    await this.prisma.ticketComment.create({
      data: { ticketId: ticket.id, authorId: claims.sub, kind: 'PUBLIC', body: input.note },
    });
    await this.notifications.notify(await this.userIdFor(ticket.requesterId), {
      type: 'helpdesk.ticket.waiting',
      title: 'Your helpdesk ticket needs something from you',
      body: ticket.subject,
      linkPath: `/helpdesk/${ticket.id}`,
    });
    return this.get(claims, ticket.id);
  }

  async resolve(claims: AccessTokenClaims, id: string, input: TicketResolveInput) {
    const { ticket } = await this.transition(
      claims,
      id,
      'resolve',
      () => ({ resolution: input.resolution, resolvedAt: new Date() }),
      'Resolved',
    );
    await this.notifications.notify(await this.userIdFor(ticket.requesterId), {
      type: 'helpdesk.ticket.resolved',
      title: 'Your helpdesk ticket was resolved',
      body: ticket.subject,
      linkPath: `/helpdesk/${ticket.id}`,
    });
    return this.get(claims, ticket.id);
  }

  async reopen(claims: AccessTokenClaims, id: string) {
    const { ticket } = await this.transition(
      claims,
      id,
      'reopen',
      () => ({ resolvedAt: null, closedAt: null }),
      'Reopened',
    );
    const recipients = ticket.assigneeId
      ? await this.userIdFor(ticket.assigneeId)
      : await this.deskUserIds(claims.orgId, claims.sub);
    await this.notifications.notify(recipients, {
      type: 'helpdesk.ticket.reopened',
      title: 'A resolved ticket was reopened',
      body: ticket.subject,
      linkPath: `/helpdesk/${ticket.id}`,
    });
    return this.get(claims, ticket.id);
  }

  /* Nobody is told. Closing is the quiet end of a conversation that already
     reached its answer. */
  async close(claims: AccessTokenClaims, id: string) {
    const { ticket } = await this.transition(
      claims,
      id,
      'close',
      () => ({ closedAt: new Date() }),
      'Closed',
    );
    return this.get(claims, ticket.id);
  }

  async cancel(claims: AccessTokenClaims, id: string, input: TicketCancelInput) {
    const ticket = await this.readable(claims, id);
    const viewer = this.viewer(claims, ticket.requesterId);
    const isRequester = claims.employeeId === ticket.requesterId;
    const next = this.resolveNext(ticket.status, 'cancel', viewer, isRequester);

    await this.prisma.ticket.update({ where: { id: ticket.id }, data: { status: next } });
    await this.systemComment(ticket.id, input.reason ? `Cancelled — ${input.reason}` : 'Cancelled');
    await auditMutation(
      this.prisma,
      this.ctx(claims),
      'helpdesk.ticket.cancel',
      'Ticket',
      ticket.id,
      {
        before: { status: ticket.status },
        after: { status: next },
        reason: input.reason ?? null,
      },
    );

    /*
     * Only when somebody else dropped it. A requester who cancelled their own
     * ticket does not need telling, and the agent finds out from the queue —
     * but somebody whose question was dropped for them must be told, by email.
     */
    if (!isRequester) {
      await this.notifications.notify(await this.userIdFor(ticket.requesterId), {
        type: 'helpdesk.ticket.cancelled',
        title: 'Your helpdesk ticket was cancelled',
        body: ticket.subject,
        linkPath: `/helpdesk/${ticket.id}`,
      });
    }
    return this.get(claims, ticket.id);
  }

  /* Neither of these tells anybody: they are housekeeping on the desk's side
     and mean nothing to the person waiting for an answer. */
  async setPriority(claims: AccessTokenClaims, id: string, priority: TicketPriorityCode) {
    const ticket = await this.readable(claims, id);
    const viewer = this.viewer(claims, ticket.requesterId);
    this.resolveNext(
      ticket.status,
      'setPriority',
      viewer,
      claims.employeeId === ticket.requesterId,
    );
    await this.prisma.ticket.update({ where: { id: ticket.id }, data: { priority } });
    await auditMutation(
      this.prisma,
      this.ctx(claims),
      'helpdesk.ticket.priority',
      'Ticket',
      ticket.id,
      {
        before: { priority: ticket.priority },
        after: { priority },
      },
    );
    return this.get(claims, ticket.id);
  }

  async recategorise(claims: AccessTokenClaims, id: string, categoryId: string) {
    const ticket = await this.readable(claims, id);
    const viewer = this.viewer(claims, ticket.requesterId);
    this.resolveNext(
      ticket.status,
      'recategorise',
      viewer,
      claims.employeeId === ticket.requesterId,
    );
    const category = await this.categories.requireActive(claims.orgId, categoryId);
    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { categoryId: category.id },
    });
    await this.systemComment(ticket.id, `Moved to ${category.name}`);
    await auditMutation(
      this.prisma,
      this.ctx(claims),
      'helpdesk.ticket.recategorise',
      'Ticket',
      ticket.id,
      {
        before: { categoryId: ticket.categoryId },
        after: { categoryId: category.id },
      },
    );
    return this.get(claims, ticket.id);
  }
}
