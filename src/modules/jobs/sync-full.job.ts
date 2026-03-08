import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { SyncService } from '@modules/sync/sync.service';
import type { SyncJobData, JobResult } from '../../types/jobs.types';

@Processor('sync-jobs')
export class SyncFullJobHandler {
  private readonly logger = new Logger(SyncFullJobHandler.name);

  constructor(private readonly sync: SyncService) {}

  @Process('sync-full')
  async handleFullSync(job: Job<SyncJobData>): Promise<JobResult> {
    this.logger.log(`🔄 Starting full sync job (Job ID: ${job.id})`);

    try {
      const result = await this.sync.syncFullHistory();

      this.logger.log(`✅ Full sync job completed (Job ID: ${job.id})`);
      return {
        success: true,
        synced: result.synced,
        failed: result.failed,
        timestamp: result.timestamp,
      };
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`❌ Full sync job failed (Job ID: ${job.id})`, err.message);
      throw err; // BullMQ will retry
    }
  }
}
