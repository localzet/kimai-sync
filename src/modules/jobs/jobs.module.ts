import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { SyncFullJobHandler } from './sync-full.job';
import { SyncWeeklyJobHandler } from './sync-weekly.job';
import { ScheduledSyncProvider } from './scheduled-sync.provider';
import { SyncModule } from '@modules/sync/sync.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'sync-jobs',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    }),
    SyncModule,
  ],
  providers: [SyncFullJobHandler, SyncWeeklyJobHandler, ScheduledSyncProvider],
})
export class JobsModule {}
