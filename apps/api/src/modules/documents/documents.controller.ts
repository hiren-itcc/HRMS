import type { DocumentCategoryCreateInput } from '@hrms/shared';
import { documentCategoryCreateSchema, documentMoveSchema } from '@hrms/shared';
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
import { DocumentCategoriesService } from './document-categories.service';
import { DocumentsService } from './documents.service';

@ApiTags('documents')
@ApiBearerAuth()
@Controller()
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly categories: DocumentCategoriesService,
  ) {}

  // ── folders ───────────────────────────────────────────────────────────

  @Get('documents/categories')
  @ApiOperation({ summary: 'Document folders with counts (optionally per employee)' })
  async listCategories(
    @CurrentUser() user: AccessTokenClaims,
    @Query('employeeId') employeeId?: string,
  ) {
    // Per-employee counts reveal what someone has on file — same gate as the list
    if (employeeId) await this.documents.assertCanReadEmployeeDocuments(user, employeeId);
    return this.categories.list(user, employeeId);
  }

  @Post('documents/categories')
  @RequirePermissions('document.manage')
  @ApiOperation({ summary: 'Create a document folder' })
  createCategory(
    @CurrentUser() user: AccessTokenClaims,
    @Body() body: DocumentCategoryCreateInput,
  ) {
    return this.categories.create(user, documentCategoryCreateSchema.parse(body));
  }

  @Patch('documents/categories/:id')
  @RequirePermissions('document.manage')
  @ApiOperation({ summary: 'Rename a document folder' })
  updateCategory(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: DocumentCategoryCreateInput,
  ) {
    return this.categories.update(user, id, documentCategoryCreateSchema.parse(body));
  }

  @Delete('documents/categories/:id')
  @RequirePermissions('document.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an empty document folder' })
  removeCategory(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.categories.remove(user, id);
  }

  // ── documents ─────────────────────────────────────────────────────────

  @Get('employees/:employeeId/documents')
  @ApiOperation({ summary: "List an employee's documents (folder filter + search)" })
  list(
    @CurrentUser() user: AccessTokenClaims,
    @Param('employeeId') employeeId: string,
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
  ) {
    return this.documents.listForEmployee(user, employeeId, { categoryId, search });
  }

  @Post('employees/:employeeId/documents')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a document (field "file", optional "categoryId")' })
  upload(
    @CurrentUser() user: AccessTokenClaims,
    @Param('employeeId') employeeId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('categoryId') categoryId?: string,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded');
    return this.documents.upload(user, employeeId, file, categoryId || undefined);
  }

  @Patch('documents/:id')
  @ApiOperation({ summary: 'Move a document to another folder' })
  move(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string, @Body() body: unknown) {
    const { categoryId } = documentMoveSchema.parse(body);
    return this.documents.move(user, id, categoryId ?? null);
  }

  @Get('documents/:id/file')
  @ApiOperation({ summary: 'Stream file content — inline for preview, ?download=1 to download' })
  async file(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Query('download') download: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { doc, stream } = await this.documents.openFile(user, id);
    const disposition = download ? 'attachment' : 'inline';
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${encodeURIComponent(doc.name)}"`,
    );
    return new StreamableFile(stream);
  }

  @Delete('documents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a document (document.manage or the self-uploader)' })
  remove(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.documents.remove(user, id);
  }
}
