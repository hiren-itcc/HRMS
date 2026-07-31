import type { AccessTokenClaims } from '@hrms/types';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { DocumentsService } from './documents.service';

@ApiTags('documents')
@ApiBearerAuth()
@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('employees/:employeeId/documents')
  @ApiOperation({ summary: "List an employee's documents (access per RBAC scope)" })
  list(@CurrentUser() user: AccessTokenClaims, @Param('employeeId') employeeId: string) {
    return this.documents.listForEmployee(user, employeeId);
  }

  @Post('employees/:employeeId/documents')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a document (PDF/DOCX/image, multipart field "file")' })
  upload(
    @CurrentUser() user: AccessTokenClaims,
    @Param('employeeId') employeeId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.documents.upload(user, employeeId, file);
  }

  @Get('documents/:id/file')
  @ApiOperation({ summary: 'Stream file content — inline for preview, ?download=1 for download' })
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
  @ApiOperation({ summary: 'Soft-delete a document (managers of docs or the self-uploader)' })
  remove(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.documents.remove(user, id);
  }
}
