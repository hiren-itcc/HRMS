import { careersApplySchema } from '@hrms/shared';
import { Body, Controller, Get, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { createZodDto } from 'nestjs-zod';
import { Public } from '../../common/decorators/public.decorator';
import { CareersService } from './careers.service';

export class CareersApplyDto extends createZodDto(careersApplySchema) {}

/**
 * The public careers page. **No token, and no `@ApiBearerAuth`.**
 *
 * This is the only unauthenticated *write* surface in the product, so it does
 * not sit alongside `/recruitment` by accident — the routes are separate, the
 * mapper is separate, and nothing here reads or returns an internal shape.
 *
 * The global throttle is 100 requests a minute. That is right for a signed-in
 * user clicking around and far too generous for a form anybody on the internet
 * can post to, so applying carries its own much tighter limit. Reads keep the
 * global one: a job board being scraped is not an attack.
 */
@ApiTags('careers')
@Controller('careers')
export class CareersController {
  constructor(private readonly careers: CareersService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Open roles — published ones only' })
  list() {
    return this.careers.list();
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'One open role' })
  get(@Param('slug') slug: string) {
    return this.careers.get(slug);
  }

  /**
   * Five a minute per IP.
   *
   * Enough for somebody who mistypes their email twice and re-attaches a CV,
   * and nowhere near enough to stuff the candidate table. The response is the
   * same whether or not this person has applied before — see the service.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':slug/apply')
  @UseInterceptors(FileInterceptor('cv'))
  @ApiOperation({ summary: 'Apply, optionally with a CV' })
  apply(
    @Param('slug') slug: string,
    @Body() dto: CareersApplyDto,
    @UploadedFile() cv?: Express.Multer.File,
  ) {
    return this.careers.apply(slug, dto, cv);
  }
}
