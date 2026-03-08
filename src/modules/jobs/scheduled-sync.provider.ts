import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';
import * as cron from 'node-cron';

@Injectable()
export class ScheduledSyncProvider implements OnModuleInit {
  private readonly logger = new Logger(ScheduledSyncProvider.name);
  private task: cron.ScheduledTask | null = null;

  constructor(
    @InjectQueue('sync-jobs') private readonly syncQueue: Queue,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    try {
      // Start with scheduler disabled until properly configured
      const syncEnabled = this.config.get<boolean>('sync.enabled') ?? true;
      this.logger.debug(`Sync scheduler enabled: ${syncEnabled}`);

      if (!syncEnabled) {
        this.logger.log('⏸️ Sync scheduler disabled via SYNC_ENABLED=false');
        return;
      }

      // Get cron expression, but make sure it's a valid cron pattern (5+ parts)
      const cronExpression = this.config.get<string>('sync.interval') ?? '*/5 * * * *';
      const parts = cronExpression.trim().split(/\s+/).length;
      
      if (parts < 5) {
        this.logger.warn(
          `Invalid cron expression "${cronExpression}" (${parts} parts, need 5+). Disabling scheduler.`,
        );
        return;
      }

      this.logger.debug(`Scheduling cron with expression: "${cronExpression}"`);
      this.task = cron.schedule(cronExpression, async () => {
        this.logger.debug('⏰ Cron triggered - queuing weekly sync...');

        try {
          await this.syncQueue.add('sync-weekly', {}, {
            removeOnComplete: true,
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
          });

          this.logger.debug('✅ Weekly sync job queued by scheduler');
        } catch (error: unknown) {
          const err = error instanceof Error ? error : new Error(String(error));
          this.logger.error('❌ Failed to queue sync job', err.message);
        }
      });

      this.logger.log(`✅ Cron scheduler initialized (pattern: "${cronExpression}"`);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn('⚠️ Cron scheduler skipped due to misconfiguration (non-critical)');
      this.logger.debug(err.message);
    }
  }

  onModuleDestroy(): void {
    if (this.task) {
      this.task.stop();
      this.logger.log('⏹️ Cron scheduler stopped');
    }
  }
}
