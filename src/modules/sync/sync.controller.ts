import { Controller, Post, Get, Param, Logger } from '@nestjs/common';
import { Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';
import { SyncService } from './sync.service';
import { PrismaService } from '../database/prisma.service';

interface SyncStats {
  total: number;
  synced: number;
  unsynced: number;
  lastSyncedAt?: string;
}

interface SyncJob {
  id: string;
  type: string;
  status: string;
  progress?: number;
  createdAt: string;
  failedReason?: string;
}

@Controller('sync')
export class SyncController {
  private readonly logger = new Logger(SyncController.name);

  constructor(
    private readonly sync: SyncService,
    private readonly prisma: PrismaService,
    @InjectQueue('sync-jobs') private readonly syncQueue: Queue,
  ) {}

  @Post('full')
  async triggerFullSync(): Promise<{ jobId: string; status: string }> {
    this.logger.log('📥 Received request to trigger full sync');

    try {
      const job = await this.syncQueue.add('sync-full', {}, {
        removeOnComplete: true,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      });

      this.logger.log(`✅ Full sync job queued (ID: ${job.id})`);
      return { jobId: String(job.id), status: 'queued' };
    } catch (error) {
      this.logger.error('❌ Failed to queue full sync', error);
      throw error;
    }
  }

  @Post('weekly')
  async triggerWeeklySync(): Promise<{ jobId: string; status: string }> {
    this.logger.log('📅 Received request to trigger weekly sync');

    try {
      const job = await this.syncQueue.add('sync-weekly', {}, {
        removeOnComplete: true,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      });

      this.logger.log(`✅ Weekly sync job queued (ID: ${job.id})`);
      return { jobId: String(job.id), status: 'queued' };
    } catch (error) {
      this.logger.error('❌ Failed to queue weekly sync', error);
      throw error;
    }
  }

  @Get('status/:jobId')
  async getJobStatus(@Param('jobId') jobId: string): Promise<any> {
    try {
      const job = await this.syncQueue.getJob(parseInt(jobId));

      if (!job) {
        return { status: 'not_found', jobId };
      }

      const state = await job.getState();
      const progress = job.progress();

      return {
        jobId,
        status: state,
        progress,
        data: job.data,
        result: job.returnvalue,
      };
    } catch (error) {
      this.logger.error('❌ Failed to get job status', error);
      throw error;
    }
  }

  @Get('stats')
  async getSyncStats(): Promise<SyncStats> {
    try {
      const [total, synced, lastSyncRecord] = await Promise.all([
        this.prisma.timeEntry.count(),
        this.prisma.timeEntry.count({ where: { synced: true } }),
        this.prisma.timeEntry.findFirst({
          where: { synced: true },
          orderBy: { syncedAt: 'desc' },
        }),
      ]);

      return {
        total,
        synced,
        unsynced: total - synced,
        lastSyncedAt: lastSyncRecord?.syncedAt?.toISOString(),
      };
    } catch (error) {
      this.logger.error('❌ Failed to get sync stats', error);
      throw error;
    }
  }

  @Get('jobs')
  async getSyncJobs(): Promise<SyncJob[]> {
    try {
      // Get recent jobs from BullMQ queue
      const count = 50;
      const jobs = await this.syncQueue.getJobs(['completed', 'failed', 'active', 'waiting'], 0, count - 1);

      return await Promise.all(jobs.map(async (job) => ({
        id: String(job.id),
        type: job.name,
        status: await job.getState(),
        progress: job.progress() as number,
        createdAt: new Date(job.timestamp).toISOString(),
        failedReason: job.failedReason,
      })));
    } catch (error) {
      this.logger.error('❌ Failed to get sync jobs', error);
      throw error;
    }
  }
}
