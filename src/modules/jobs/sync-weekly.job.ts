import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { SyncService } from '@modules/sync/sync.service';
import type { SyncJobData, JobResult } from '../../types/jobs.types';

@Processor('sync-jobs')
export class SyncWeeklyJobHandler {
  private readonly logger = new Logger(SyncWeeklyJobHandler.name);

  constructor(private readonly sync: SyncService) {}

  @Process('sync-weekly')
  async handleWeeklySync(job: Job<SyncJobData>): Promise<JobResult> {
    this.logger.log(`📅 Starting weekly sync job (Job ID: ${job.id})`);

    try {
      const result = await this.sync.syncCurrentWeek();

      this.logger.log(`✅ Weekly sync job completed (Job ID: ${job.id})`);
      return {
        success: true,
        synced: result.synced,
        failed: result.failed,
        timestamp: result.timestamp,
      };
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`❌ Weekly sync job failed (Job ID: ${job.id})`, err.message);
      throw err; // BullMQ will retry
    }
  }
}
