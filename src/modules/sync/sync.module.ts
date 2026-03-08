import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { KimaiModule } from '@modules/kimai/kimai.module';
import { DatabaseModule } from '@modules/database/database.module';
import { NotionModule } from '@modules/notion/notion.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'sync-jobs',
    }),
    KimaiModule,
    DatabaseModule,
    NotionModule,
  ],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
