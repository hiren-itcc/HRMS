import { type CareersApplyInput, type PublicOpening, slugify } from '@hrms/shared';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';

/**
 * The public half of recruitment.
 *
 * Everything in here runs for somebody with no token, no organization and no
 * audit identity, so none of the assumptions the rest of the API makes about a
 * caller hold. Three rules follow from that and each is load-bearing:
 *
 * 1. **Only `OPEN` openings with a slug are visible.** A `DRAFT` role is a
 *    conversation the company is having with itself.
 * 2. **The response is built field by field.** Never spread an opening — it
 *    carries a salary band and a hiring manager.
 * 3. **Nothing distinguishes "no such role" from "not published".** Both are
 *    404, or the endpoint becomes a way to enumerate unannounced hiring.
 */

/** PDF and Word only. A CV is not a PNG, and every image type is one more parser. */
const CV_MIME: Record<string, true> = {
  'application/pdf': true,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
};
const CV_EXT = new Set(['.pdf', '.docx']);
const MAX_CV_BYTES = 5 * 1024 * 1024;

const PUBLIC_INCLUDE = {
  department: { select: { name: true } },
  location: { select: { name: true } },
  employmentType: { select: { name: true } },
} as const;

interface OpeningRow {
  slug: string | null;
  title: string;
  description: string | null;
  openedOn: Date | null;
  department: { name: string } | null;
  location: { name: string } | null;
  employmentType: { name: string } | null;
}

/**
 * The public shape, assembled by hand.
 *
 * A spread here would publish `minMonthlyCtc`, `maxMonthlyCtc`,
 * `hiringManagerId`, `headcount` and `createdById`. There is a test that
 * serialises the output and searches it, because that is the failure that
 * would matter and it is invisible in a diff.
 */
function toPublic(row: OpeningRow): PublicOpening {
  return {
    slug: row.slug as string,
    title: row.title,
    department: row.department?.name ?? null,
    location: row.location?.name ?? null,
    employmentType: row.employmentType?.name ?? null,
    description: row.description,
    openedOn: row.openedOn ? row.openedOn.toISOString().slice(0, 10) : null,
  };
}

@Injectable()
export class CareersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CareersService.name);
  }

  /**
   * Which organization a public visitor is looking at.
   *
   * There is exactly one today — `organizationId` scoping is in place
   * throughout but dormant, and the roadmap's answer for multiple tenants is a
   * per-org subdomain plus RLS. Rather than invent half of that now, this
   * resolves the single organization and says so plainly if that assumption
   * ever stops holding. Guessing would be worse: it would publish one
   * company's vacancies under another's URL.
   */
  private async organizationId(): Promise<string> {
    const orgs = await this.prisma.organization.findMany({ select: { id: true }, take: 2 });
    if (orgs.length === 0) throw new NotFoundException('No openings');
    if (orgs.length > 1) {
      throw new BadRequestException(
        'The careers page needs a per-organization host before it can serve more than one tenant',
      );
    }
    return (orgs[0] as { id: string }).id;
  }

  async list(): Promise<PublicOpening[]> {
    const orgId = await this.organizationId();
    const rows = await this.prisma.jobOpening.findMany({
      // Both halves matter: OPEN is the company's decision to hire, a slug is
      // its decision to say so publicly.
      where: { organizationId: orgId, status: 'OPEN', slug: { not: null } },
      include: PUBLIC_INCLUDE,
      orderBy: [{ openedOn: 'desc' }, { title: 'asc' }],
    });
    return rows.map(toPublic);
  }

  async get(slug: string): Promise<PublicOpening> {
    const orgId = await this.organizationId();
    const row = await this.prisma.jobOpening.findFirst({
      where: { organizationId: orgId, slug, status: 'OPEN' },
      include: PUBLIC_INCLUDE,
    });
    // A closed role and a role that never existed answer identically.
    if (!row) throw new NotFoundException('That role is no longer open');
    return toPublic(row);
  }

  /**
   * Somebody applying from outside.
   *
   * **Always reports success**, whether this is their first application or
   * their fifth. "You have already applied" is a way to test whether an email
   * address is in the database, and a careers page is the one endpoint where
   * anybody at all can ask.
   */
  async apply(
    slug: string,
    input: CareersApplyInput,
    cv?: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<{ received: true }> {
    const orgId = await this.organizationId();
    const opening = await this.prisma.jobOpening.findFirst({
      where: { organizationId: orgId, slug, status: 'OPEN' },
      select: { id: true, title: true },
    });
    if (!opening) throw new NotFoundException('That role is no longer open');

    const resumeDocumentId = cv ? await this.storeCv(orgId, cv) : null;

    /*
     * Upsert on (organizationId, email), which is the table's own unique key.
     * Somebody applying to a second role is the same person, and their details
     * are refreshed rather than duplicated — but `source` and `referrerId` are
     * never touched, because those belong to whoever is doing the hiring.
     */
    const candidate = await this.prisma.candidate.upsert({
      where: { organizationId_email: { organizationId: orgId, email: input.email } },
      create: {
        organizationId: orgId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone ?? null,
        currentEmployer: input.currentEmployer ?? null,
        currentTitle: input.currentTitle ?? null,
        noticePeriodDays: input.noticePeriodDays ?? null,
        source: 'Careers page',
        notes: input.message ?? null,
      },
      update: {
        firstName: input.firstName,
        lastName: input.lastName,
        ...(input.phone ? { phone: input.phone } : {}),
        ...(input.currentEmployer ? { currentEmployer: input.currentEmployer } : {}),
        ...(input.currentTitle ? { currentTitle: input.currentTitle } : {}),
        ...(input.noticePeriodDays !== undefined
          ? { noticePeriodDays: input.noticePeriodDays }
          : {}),
      },
      select: { id: true, firstName: true, lastName: true },
    });

    /*
     * `@@unique([candidateId, openingId])` — applying twice is the same
     * application, not a second one, so this cannot duplicate. The update is
     * deliberately narrow: a re-application may attach a newer CV, and must
     * never drag a candidate who has reached INTERVIEW back to APPLIED.
     */
    const existing = await this.prisma.application.findUnique({
      where: { candidateId_openingId: { candidateId: candidate.id, openingId: opening.id } },
      select: { id: true },
    });

    if (existing) {
      if (resumeDocumentId) {
        await this.prisma.application.update({
          where: { id: existing.id },
          data: { resumeDocumentId },
        });
      }
      return { received: true };
    }

    await this.prisma.application.create({
      data: {
        organizationId: orgId,
        candidateId: candidate.id,
        openingId: opening.id,
        resumeDocumentId,
      },
    });

    // Told through the permission rather than by naming anybody, so an
    // organization that composes its own recruiter role is reached too.
    await this.notifications.notifyPermission(orgId, 'recruitment.read', {
      type: 'recruitment.applied',
      title: `${candidate.firstName} ${candidate.lastName} applied`,
      body: opening.title,
      linkPath: '/recruitment/candidates',
    });

    return { received: true };
  }

  /**
   * An anonymous file, into a private bucket.
   *
   * Checked on **both** the declared type and the extension. A browser sends
   * whatever content type it likes, and an extension is chosen by whoever
   * uploads — neither alone is a check, and agreeing with each other is the
   * cheapest thing that is.
   *
   * Stored under `<orgId>/careers/` so an anonymous upload can never be
   * mistaken for an employee's own document, and the `Document` row carries no
   * `employeeId` and no `uploadedById`, because there is no employee and no
   * user. Both columns are already nullable.
   */
  private async storeCv(
    orgId: string,
    cv: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<string> {
    const dot = cv.originalname.lastIndexOf('.');
    const ext = dot === -1 ? '' : cv.originalname.slice(dot).toLowerCase();
    if (!CV_MIME[cv.mimetype] || !CV_EXT.has(ext)) {
      throw new BadRequestException('Attach your CV as a PDF or Word document');
    }
    if (cv.size > MAX_CV_BYTES) {
      throw new BadRequestException('That file is too large — the limit is 5 MB');
    }

    const fileKey = await this.storage.put(
      `${orgId}/careers`,
      cv.originalname,
      cv.buffer,
      cv.mimetype,
    );
    const doc = await this.prisma.document.create({
      data: {
        organizationId: orgId,
        name: cv.originalname,
        fileKey,
        mimeType: cv.mimetype,
        sizeBytes: cv.size,
        uploadedById: null,
      },
      select: { id: true },
    });
    return doc.id;
  }

  /**
   * A slug nobody else in the organization is using.
   *
   * Called when an opening is published, not when it is created: a DRAFT has
   * no public URL, and generating one early would mean a title edit either
   * breaks a link that was never live or leaves a slug that matches nothing.
   */
  async ensureSlug(orgId: string, openingId: string, title: string): Promise<string> {
    const base = slugify(title) || 'role';
    for (let suffix = 0; suffix < 50; suffix++) {
      const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
      const clash = await this.prisma.jobOpening.findFirst({
        where: { organizationId: orgId, slug: candidate, id: { not: openingId } },
        select: { id: true },
      });
      if (!clash) return candidate;
    }
    // Fifty roles with one title is not a naming problem worth more code.
    return `${base}-${openingId.slice(-6)}`;
  }
}
