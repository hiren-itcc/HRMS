import { Module } from '@nestjs/common';
import { LetterTemplatesService } from './letter-templates.service';
import { LettersController } from './letters.controller';
import { LettersService } from './letters.service';

@Module({
  controllers: [LettersController],
  providers: [LettersService, LetterTemplatesService],
  exports: [LettersService],
})
export class LettersModule {}
