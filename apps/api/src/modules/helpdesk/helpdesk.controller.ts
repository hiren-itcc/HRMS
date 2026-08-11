import {
  ticketAssignSchema,
  ticketCancelSchema,
  ticketCategoryCreateSchema,
  ticketCategoryQuerySchema,
  ticketCategorySetSchema,
  ticketCategoryUpdateSchema,
  ticketCommentCreateSchema,
  ticketCreateSchema,
  ticketPrioritySetSchema,
  ticketQuerySchema,
  ticketResolveSchema,
  ticketWaitSchema,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TicketCategoriesService } from './ticket-categories.service';
import { TicketsService } from './tickets.service';

export class TicketCreateDto extends createZodDto(ticketCreateSchema) {}
export class TicketQueryDto extends createZodDto(ticketQuerySchema) {}
export class TicketCommentCreateDto extends createZodDto(ticketCommentCreateSchema) {}
export class TicketAssignDto extends createZodDto(ticketAssignSchema) {}
export class TicketResolveDto extends createZodDto(ticketResolveSchema) {}
export class TicketWaitDto extends createZodDto(ticketWaitSchema) {}
export class TicketCancelDto extends createZodDto(ticketCancelSchema) {}
export class TicketPrioritySetDto extends createZodDto(ticketPrioritySetSchema) {}
export class TicketCategorySetDto extends createZodDto(ticketCategorySetSchema) {}
export class TicketCategoryCreateDto extends createZodDto(ticketCategoryCreateSchema) {}
export class TicketCategoryUpdateDto extends createZodDto(ticketCategoryUpdateSchema) {}
export class TicketCategoryQueryDto extends createZodDto(ticketCategoryQuerySchema) {}

/**
 * The helpdesk (docs/03-api-structure.md §helpdesk).
 *
 * Read routes carry the weakest code that could reach them —
 * `helpdesk.read.own` — and the service narrows from there, because the guard
 * cannot know whose ticket an id belongs to. Reply, close, reopen and cancel
 * are the same shape: the guard lets you in, and the service decides whether
 * you are the requester on this one or somebody working the desk.
 *
 * Refusing an unreadable ticket is a **404**, not a 403 — whether a ticket
 * exists is itself information.
 */
@ApiTags('helpdesk')
@ApiBearerAuth()
@Controller('helpdesk')
export class HelpdeskController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly categories: TicketCategoriesService,
  ) {}

  /* Declared before ':id' so they are never read as a ticket id. */
  @Get('categories')
  @RequirePermissions('helpdesk.read.own')
  @ApiOperation({ summary: 'The desks a ticket can be raised against' })
  listCategories(@CurrentUser() user: AccessTokenClaims, @Query() query: TicketCategoryQueryDto) {
    return this.categories.list(user.orgId, query.active);
  }

  @Post('categories')
  @RequirePermissions('helpdesk.manage')
  @ApiOperation({ summary: 'Add a desk' })
  createCategory(@CurrentUser() user: AccessTokenClaims, @Body() body: TicketCategoryCreateDto) {
    return this.categories.create(user, body);
  }

  @Patch('categories/:id')
  @RequirePermissions('helpdesk.manage')
  @ApiOperation({ summary: 'Rename a desk, or change who picks it up' })
  updateCategory(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: TicketCategoryUpdateDto,
  ) {
    return this.categories.update(user, id, body);
  }

  @Delete('categories/:id')
  @RequirePermissions('helpdesk.manage')
  @ApiOperation({ summary: 'Remove a desk nothing references' })
  removeCategory(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.categories.remove(user, id);
  }

  @Get('summary')
  @RequirePermissions('helpdesk.read.own')
  @ApiOperation({ summary: 'Counts behind the tabs' })
  summary(@CurrentUser() user: AccessTokenClaims) {
    return this.tickets.summary(user);
  }

  @Get('tickets')
  @RequirePermissions('helpdesk.read.own')
  @ApiOperation({ summary: 'Tickets, in the scope you asked for and hold' })
  list(@CurrentUser() user: AccessTokenClaims, @Query() query: TicketQueryDto) {
    return this.tickets.list(user, query);
  }

  @Post('tickets')
  @RequirePermissions('helpdesk.raise.own')
  @ApiOperation({ summary: 'Ask the company something' })
  create(@CurrentUser() user: AccessTokenClaims, @Body() body: TicketCreateDto) {
    return this.tickets.create(user, body);
  }

  @Get('tickets/:id')
  @RequirePermissions('helpdesk.read.own')
  @ApiOperation({ summary: 'One ticket and its thread' })
  get(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.tickets.get(user, id);
  }

  @Post('tickets/:id/comments')
  @RequirePermissions('helpdesk.read.own')
  @ApiOperation({ summary: 'Reply, or leave an internal note' })
  comment(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: TicketCommentCreateDto,
  ) {
    return this.tickets.comment(user, id, body);
  }

  @Post('tickets/:id/assign')
  @RequirePermissions('helpdesk.respond')
  @ApiOperation({ summary: 'Hand it to somebody, or back to the queue' })
  assign(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: TicketAssignDto,
  ) {
    return this.tickets.assign(user, id, body);
  }

  @Post('tickets/:id/start')
  @RequirePermissions('helpdesk.respond')
  @ApiOperation({ summary: 'Pick it up' })
  start(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.tickets.start(user, id);
  }

  @Post('tickets/:id/wait')
  @RequirePermissions('helpdesk.respond')
  @ApiOperation({ summary: 'Put it on hold pending an answer' })
  wait(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: TicketWaitDto,
  ) {
    return this.tickets.wait(user, id, body);
  }

  @Post('tickets/:id/resolve')
  @RequirePermissions('helpdesk.respond')
  @ApiOperation({ summary: 'Say what was done' })
  resolve(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: TicketResolveDto,
  ) {
    return this.tickets.resolve(user, id, body);
  }

  @Post('tickets/:id/reopen')
  @RequirePermissions('helpdesk.read.own')
  @ApiOperation({ summary: 'That did not fix it' })
  reopen(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.tickets.reopen(user, id);
  }

  @Post('tickets/:id/close')
  @RequirePermissions('helpdesk.read.own')
  @ApiOperation({ summary: 'Accept the resolution' })
  close(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.tickets.close(user, id);
  }

  @Post('tickets/:id/cancel')
  @RequirePermissions('helpdesk.read.own')
  @ApiOperation({ summary: 'Withdraw it, or drop a duplicate' })
  cancel(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: TicketCancelDto,
  ) {
    return this.tickets.cancel(user, id, body);
  }

  @Patch('tickets/:id/priority')
  @RequirePermissions('helpdesk.respond')
  @ApiOperation({ summary: 'How urgent this actually is' })
  setPriority(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: TicketPrioritySetDto,
  ) {
    return this.tickets.setPriority(user, id, body.priority);
  }

  @Patch('tickets/:id/category')
  @RequirePermissions('helpdesk.respond')
  @ApiOperation({ summary: 'Move it to the desk that should have it' })
  recategorise(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: TicketCategorySetDto,
  ) {
    return this.tickets.recategorise(user, id, body.categoryId);
  }
}
