import { notificationPreferencesSchema, notificationQuerySchema } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

export class NotificationQueryDto extends createZodDto(notificationQuerySchema) {}
export class NotificationPreferencesDto extends createZodDto(notificationPreferencesSchema) {}

/**
 * No `@RequirePermissions` on any route, deliberately.
 *
 * Every one of these is scoped to the JWT subject and never reads an id from a
 * parameter to decide *whose* data it is — the same rule `/auth/sessions` and
 * `/me/profile` follow (doc 04 §Enforcement). A permission would be weaker,
 * not stronger: it would be a thing an administrator could grant somebody over
 * another person's notifications.
 *
 * There is no endpoint that creates one. Notifications are a consequence of
 * something else happening, never a thing anybody posts.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Your notifications, newest first' })
  list(@CurrentUser() user: AccessTokenClaims, @Query() query: NotificationQueryDto) {
    return this.notifications.list(user, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Badge count for the bell' })
  unreadCount(@CurrentUser() user: AccessTokenClaims) {
    return this.notifications.unreadCount(user);
  }

  /*
   * Declared before ':id/read' for the same reason 'unread-count' is: a later
   * parameterised route would otherwise swallow it.
   */
  @Get('preferences')
  @ApiOperation({ summary: 'Whether your notifications are also emailed to you' })
  preferences(@CurrentUser() user: AccessTokenClaims) {
    return this.notifications.preferences(user);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Turn notification email on or off for yourself' })
  updatePreferences(
    @CurrentUser() user: AccessTokenClaims,
    @Body() dto: NotificationPreferencesDto,
  ) {
    return this.notifications.updatePreferences(user, dto);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark everything read' })
  markAllRead(@CurrentUser() user: AccessTokenClaims) {
    return this.notifications.markAllRead(user);
  }

  /* Declared after 'unread-count' and 'read-all' so neither is read as an id. */
  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark one read' })
  markRead(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.notifications.markRead(user, id);
  }
}
