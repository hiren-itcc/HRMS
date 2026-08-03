import {
  letterIssueSchema,
  letterPreviewQuerySchema,
  letterTemplateUpdateSchema,
  letterVoidSchema,
} from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { LetterTemplatesService } from './letter-templates.service';
import { LettersService } from './letters.service';

class LetterIssueDto extends createZodDto(letterIssueSchema) {}
class LetterPreviewDto extends createZodDto(letterPreviewQuerySchema) {}
class LetterVoidDto extends createZodDto(letterVoidSchema) {}
class LetterTemplateUpdateDto extends createZodDto(letterTemplateUpdateSchema) {}

@ApiTags('letters')
@ApiBearerAuth()
@Controller()
export class LettersController {
  constructor(
    private readonly letters: LettersService,
    private readonly templates: LetterTemplatesService,
  ) {}

  // ── templates ─────────────────────────────────────────────────────────
  // Declared before /letters/:id so "templates" is never read as an id.

  @Get('letters/templates')
  @RequirePermissions('letter.template.manage')
  @ApiOperation({ summary: 'Letter templates — shipped copy merged with org edits' })
  listTemplates(@CurrentUser() user: AccessTokenClaims) {
    return this.templates.list(user);
  }

  @Put('letters/templates/:key')
  @RequirePermissions('letter.template.manage')
  @ApiOperation({ summary: 'Edit a letter template for this organization' })
  updateTemplate(
    @CurrentUser() user: AccessTokenClaims,
    @Param('key') key: string,
    @Body() dto: LetterTemplateUpdateDto,
  ) {
    return this.templates.update(user, key, dto);
  }

  @Delete('letters/templates/:key')
  @RequirePermissions('letter.template.manage')
  @ApiOperation({ summary: 'Reset a letter template to the shipped default' })
  resetTemplate(@CurrentUser() user: AccessTokenClaims, @Param('key') key: string) {
    return this.templates.reset(user, key);
  }

  // ── letters ───────────────────────────────────────────────────────────

  /** A GET because it persists nothing, and the verb should say so. */
  @Get('letters/preview')
  @RequirePermissions('letter.issue')
  @ApiOperation({ summary: 'Render a letter without issuing it' })
  preview(@CurrentUser() user: AccessTokenClaims, @Query() query: LetterPreviewDto) {
    return this.letters.preview(user, query);
  }

  @Get('me/letters')
  @RequirePermissions('letter.read.own')
  @ApiOperation({ summary: 'Letters issued to the signed-in employee' })
  listMine(@CurrentUser() user: AccessTokenClaims) {
    return this.letters.listMine(user);
  }

  @Get('employees/:employeeId/letters')
  @ApiOperation({ summary: 'Letters issued to an employee (own, or letter.read)' })
  listForEmployee(@CurrentUser() user: AccessTokenClaims, @Param('employeeId') employeeId: string) {
    return this.letters.listForEmployee(user, employeeId);
  }

  @Post('letters')
  @RequirePermissions('letter.issue')
  @ApiOperation({ summary: 'Issue a letter — renders and freezes it' })
  issue(@CurrentUser() user: AccessTokenClaims, @Body() dto: LetterIssueDto) {
    return this.letters.issue(user, dto);
  }

  @Get('letters/:id')
  @ApiOperation({ summary: 'One issued letter, including its frozen HTML' })
  detail(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.letters.detail(user, id);
  }

  @Post('letters/:id/void')
  @RequirePermissions('letter.issue')
  @ApiOperation({ summary: 'Withdraw a letter — kept and marked, never deleted' })
  void(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() dto: LetterVoidDto,
  ) {
    return this.letters.void(user, id, dto.reason);
  }
}
