import { importCommitSchema, importPreviewQuerySchema } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { EmployeeImportService } from './employee-import.service';

export class ImportPreviewQueryDto extends createZodDto(importPreviewQuerySchema) {}
export class ImportCommitDto extends createZodDto(importCommitSchema) {}

/**
 * A CSV is the only format accepted **in**.
 *
 * Export offers SpreadsheetML as well, and that asymmetry is deliberate:
 * reading real xlsx needs a zip-and-XML dependency, and the obvious candidate
 * has a poor security history. The screen says so rather than letting somebody
 * discover it by uploading.
 *
 * The mime check is close to worthless for CSV — Excel on Windows sends
 * `application/vnd.ms-excel` and several browsers send `application/octet-stream`
 * — so the real gate is the extension plus the header row parsing, exactly as
 * the careers CV upload checks both rather than trusting either.
 */
const CSV_MIME = new Set([
  'text/csv',
  'text/plain',
  'application/csv',
  'application/vnd.ms-excel',
  'application/octet-stream',
]);

/**
 * Its own controller rather than more routes on `EmployeesController`.
 *
 * That file already declares `@Get(':id')`, so `import/template` would have to
 * be declared above it or be read as an employee id — a trap it navigates
 * correctly today for `options` and would have to keep navigating. A separate
 * controller sidesteps it and keeps the multipart configuration next to the
 * routes that use it.
 */
@ApiTags('employees')
@ApiBearerAuth()
@Controller('employees/import')
export class EmployeeImportController {
  constructor(private readonly imports: EmployeeImportService) {}

  @Get('template')
  @RequirePermissions('employee.import')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="employee-import-template.csv"')
  @ApiOperation({ summary: 'A blank sheet with the columns this accepts' })
  template(): string {
    return this.imports.template();
  }

  @Post('preview')
  @RequirePermissions('employee.import')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Dry run — parse, resolve and validate, writing nothing' })
  preview(
    @CurrentUser() user: AccessTokenClaims,
    @UploadedFile() file: Express.Multer.File,
    @Query() query: ImportPreviewQueryDto,
  ) {
    if (!file) throw new BadRequestException('Choose a file to import');
    const extension = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase();
    if (extension !== '.csv' || !CSV_MIME.has(file.mimetype)) {
      throw new BadRequestException(
        'Import accepts a .csv file. Export offers Excel, but reading it back is not supported — save as CSV first.',
      );
    }
    return this.imports.preview(user, file, query.mode);
  }

  @Post(':id/commit')
  @RequirePermissions('employee.import')
  @ApiOperation({ summary: 'Create the people the preview accepted' })
  commit(
    @CurrentUser() user: AccessTokenClaims,
    @Param('id') id: string,
    @Body() body: ImportCommitDto,
  ) {
    return this.imports.commit(user, id, body);
  }

  @Get(':id')
  @RequirePermissions('employee.import')
  @ApiOperation({ summary: 'What an import did, readable afterwards' })
  get(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.imports.get(user, id);
  }
}
