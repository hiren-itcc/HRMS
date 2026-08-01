import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AnnouncementsService } from './announcements.service';
import {
  AnnouncementCreateDto,
  AnnouncementQueryDto,
  AnnouncementUpdateDto,
} from './dto/announcement.dto';

@ApiTags('announcements')
@ApiBearerAuth()
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  @RequirePermissions('announcement.read')
  @ApiOperation({ summary: 'Feed — audience-filtered, pinned first, with unread flags' })
  list(@CurrentUser() user: AccessTokenClaims, @Query() query: AnnouncementQueryDto) {
    return this.announcements.list(user, query);
  }

  @Get('unread-count')
  @RequirePermissions('announcement.read')
  @ApiOperation({ summary: 'Number of unread announcements for the badge' })
  unreadCount(@CurrentUser() user: AccessTokenClaims) {
    return this.announcements.unreadCount(user);
  }

  @Post('read-all')
  @RequirePermissions('announcement.read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark every visible announcement as read' })
  markAllRead(@CurrentUser() user: AccessTokenClaims) {
    return this.announcements.markAllRead(user);
  }

  @Get('attachments/:attachmentId/file')
  @RequirePermissions('announcement.read')
  @ApiOperation({ summary: 'Stream an attachment (?download=1 to force a download)' })
  async attachmentFile(
    @CurrentUser() user: AccessTokenClaims,
    @Param('attachmentId') attachmentId: string,
    @Query('download') download: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { attachment, stream } = await this.announcements.openAttachment(user, attachmentId);
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(attachment.name)}"`,
    );
    return new StreamableFile(stream);
  }

  @Delete('attachments/:attachmentId')
  @RequirePermissions('announcement.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an attachment' })
  removeAttachment(
    @CurrentUser() user: AccessTokenClaims,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.announcements.removeAttachment(user, attachmentId);
  }

  @Get(':id')
  @RequirePermissions('announcement.read')
  @ApiOperation({ summary: 'One announcement (404 when it is not targeted at you)' })
  detail(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.announcements.detail(user, id);
  }

  @Post()
  @RequirePermissions('announcement.manage')
  @ApiOperation({ summary: 'Publish or schedule an announcement' })
  create(@CurrentUser() user: AccessTokenClaims, @Body() dto: AnnouncementCreateDto) {
    return this.announcements.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('announcement.manage')
  @ApiOperation({ summary: 'Edit an announcement' })
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: AnnouncementUpdateDto,
  ) {
    return this.announcements.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('announcement.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an announcement and its attachments' })
  remove(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.announcements.remove(user, id);
  }

  @Post(':id/read')
  @RequirePermissions('announcement.read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark one announcement as read' })
  markRead(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.announcements.markRead(user, id);
  }

  @Get(':id/reads')
  @RequirePermissions('announcement.manage')
  @ApiOperation({ summary: 'Read receipts — who has opened this announcement' })
  reads(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.announcements.reads(user, id);
  }

  @Post(':id/attachments')
  @RequirePermissions('announcement.manage')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Attach a file (multipart field "file")' })
  addAttachment(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded');
    return this.announcements.addAttachment(user, id, file);
  }
}
