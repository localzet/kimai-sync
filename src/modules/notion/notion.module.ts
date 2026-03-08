import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DatabaseModule } from '@modules/database/database.module';
import { NotionService } from './notion.service';
import { NotionClient } from './notion.client';

@Module({
  imports: [HttpModule, DatabaseModule],
  providers: [NotionService, NotionClient],
  exports: [NotionService],
})
export class NotionModule {}
