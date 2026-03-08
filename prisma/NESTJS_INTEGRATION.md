/**
 * NestJS Module Integration Guide
 * 
 * Shows how to integrate Prisma and the DatabaseService into your NestJS application.
 */

// ============================================================================
// 1. DATABASE MODULE (database.module.ts)
// ============================================================================

import { Module, Global } from '@nestjs/common';
import { DatabaseService } from './database.service';

/**
 * Global module provides DatabaseService to all other modules without reimporting.
 * 
 * Usage in other modules:
 * - constructor(private db: DatabaseService) {}
 */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}

// ============================================================================
// 2. SYNC SERVICE (sync.service.ts)
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';

/**
 * Core sync orchestration service
 * Coordinates fetching from Kimai, storing in database, and syncing to Notion
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private db: DatabaseService,
    // Inject other services as needed: Kimai, Notion, etc.
  ) {}

  /**
   * Weekly sync: Sync current week's unsynced entries
   */
  async syncCurrentWeek(): Promise<{ synced: number; errors: number }> {
    const today = new Date();
    const weekStart = this.getWeekStart(today);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    try {
      // 1. Get unsynced entries from database
      const entries = await this.db.getUnsyncedEntriesInRange(weekStart, weekEnd);
      this.logger.log(`Found ${entries.length} unsynced entries for this week`);

      // 2. Sync each entry to Notion (async, non-blocking)
      const syncPromises = entries.map((entry) =>
        this.syncEntryToNotion(entry).catch((err) => {
          this.logger.error(`Failed to sync entry ${entry.id}:`, err);
        }),
      );

      // Fire and forget (non-blocking)
      Promise.allSettled(syncPromises);

      // 3. For demonstration: update sync status in database
      const entryIds = entries.map((e) => e.id);
      const synced = await this.db.batchMarkEntriesSynced(entryIds);

      return {
        synced,
        errors: entries.length - synced,
      };
    } catch (error) {
      this.logger.error('Weekly sync failed:', error);
      throw error;
    }
  }

  /**
   * Full history sync: Sync last 3 years from Kimai
   */
  async syncFullHistory(
    projectId?: number,
  ): Promise<{ synced: number; errors: number }> {
    const projects = projectId
      ? [await this.db.getProjectById(projectId)]
      : await this.db.getActiveProjects();

    let totalSynced = 0;
    let totalErrors = 0;

    for (const project of projects) {
      if (!project) continue;

      try {
        // Get all entries from last 3 years
        const entries = await this.db.getFullHistoryForProject(project.id);
        this.logger.log(`Syncing ${entries.length} entries for project ${project.name}`);

        // Sync to Kimai (or update from Kimai - depends on your flow)
        // ...

        totalSynced += entries.length;
      } catch (error) {
        this.logger.error(`Failed to sync project ${project.name}:`, error);
        totalErrors++;
      }
    }

    return { synced: totalSynced, errors: totalErrors };
  }

  /**
   * Sync a single entry to Notion
   * Called by weekly sync (non-blocking)
   */
  private async syncEntryToNotion(entry: any): Promise<void> {
    // Implementation depends on Notion integration
    // Example:
    // return this.notion.createPage(entry.notionDatabaseId, {...});
  }

  private getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  }
}

// ============================================================================
// 3. SYNC JOB HANDLERS (sync.job.ts)
// ============================================================================

import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';

/**
 * BullMQ job handlers for queued sync operations
 */
@Processor('sync-jobs')
export class SyncJobHandler {
  private readonly logger = new Logger(SyncJobHandler.name);

  constructor(private sync: SyncService) {}

  /**
   * Handle full sync job (last 3 years)
   * Can be triggered on-demand via API endpoint
   */
  @Process('sync-full')
  async handleFullSync(job: Job<{ projectId?: number }>) {
    this.logger.log('🔄 Starting full history sync...');

    try {
      const result = await this.sync.syncFullHistory(job.data.projectId);
      this.logger.log(`✅ Full sync completed: ${result.synced} entries, ${result.errors} errors`);
      return result;
    } catch (error) {
      this.logger.error('❌ Full sync failed:', error);
      throw error; // BullMQ will retry based on configuration
    }
  }

  /**
   * Handle weekly sync job (current week)
   * Triggered automatically every 5 minutes
   */
  @Process('sync-weekly')
  async handleWeeklySync(job: Job) {
    this.logger.log('📅 Starting weekly sync...');

    try {
      const result = await this.sync.syncCurrentWeek();
      this.logger.log(`✅ Weekly sync completed: ${result.synced} entries synced, ${result.errors} errors`);
      return result;
    } catch (error) {
      this.logger.error('❌ Weekly sync failed:', error);
      throw error;
    }
  }
}

// ============================================================================
// 4. SYNC CONTROLLER (sync.controller.ts)
// ============================================================================

import { Controller, Post, BadRequestException } from '@nestjs/common';
import { Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';

/**
 * REST API endpoints to trigger sync operations on-demand
 */
@Controller('sync')
export class SyncController {
  private readonly logger = new Logger(SyncController.name);

  constructor(@InjectQueue('sync-jobs') private syncQueue: Queue) {}

  /**
   * POST /sync/full
   * Trigger full history sync (last 3 years)
   */
  @Post('full')
  async triggerFullSync() {
    try {
      const job = await this.syncQueue.add('sync-full', {}, {
        removeOnComplete: true,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        attempts: 3,
      });

      this.logger.log(`Queued full sync job: ${job.id}`);
      return {
        success: true,
        jobId: job.id,
        status: 'queued',
      };
    } catch (error) {
      this.logger.error('Failed to queue full sync:', error);
      throw new BadRequestException('Failed to queue sync job');
    }
  }

  /**
   * POST /sync/weekly
   * Trigger immediate weekly sync (normally runs every 5 min automatically)
   */
  @Post('weekly')
  async triggerWeeklySync() {
    try {
      const job = await this.syncQueue.add('sync-weekly', {}, {
        removeOnComplete: true,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        attempts: 3,
      });

      this.logger.log(`Queued weekly sync job: ${job.id}`);
      return {
        success: true,
        jobId: job.id,
        status: 'queued',
      };
    } catch (error) {
      this.logger.error('Failed to queue weekly sync:', error);
      throw new BadRequestException('Failed to queue sync job');
    }
  }
}

// ============================================================================
// 5. APP MODULE (app.module.ts) - Put It All Together
// ============================================================================

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';

/**
 * Main application module that includes all sync infrastructure
 */
@Module({
  imports: [
    // Database
    DatabaseModule,

    // Job queue
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),
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

    // Scheduling
    ScheduleModule.forRoot(),
  ],
  controllers: [SyncController],
  providers: [SyncService, SyncJobHandler, ScheduledSyncProvider],
})
export class AppModule {}

// ============================================================================
// 6. SCHEDULED SYNC PROVIDER (scheduled-sync.provider.ts)
// ============================================================================

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as cron from 'node-cron';

/**
 * Automatically trigger weekly sync every 5 minutes when app starts
 */
@Injectable()
export class ScheduledSyncProvider implements OnModuleInit {
  private readonly logger = new Logger(ScheduledSyncProvider.name);

  constructor(@InjectQueue('sync-jobs') private syncQueue: Queue) {}

  onModuleInit() {
    // Every 5 minutes: 0, 5, 10, 15, ...
    const schedule = '*/5 * * * *';

    cron.schedule(schedule, async () => {
      try {
        this.logger.log('⏰ Triggering scheduled weekly sync...');
        
        await this.syncQueue.add('sync-weekly', {}, {
          removeOnComplete: true,
          priority: 10, // Higher priority for scheduled jobs
        });
      } catch (error) {
        this.logger.error('Failed to schedule weekly sync:', error);
      }
    });

    this.logger.log(`✅ Cron scheduler initialized (every 5 minutes): "${schedule}"`);
  }
}

// ============================================================================
// 7. CONFIGURATION (config/database.config.ts)
// ============================================================================

import { registerAs } from '@nestjs/config';

/**
 * Database configuration using environment variables
 * Usage: inject ConfigService and get('database')
 */
export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL,
  
  // Connection pool settings
  connection: {
    timeout: parseInt(process.env.DB_TIMEOUT || '10000'),
    idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
  },

  // Sync settings
  sync: {
    weeklyInterval: process.env.SYNC_INTERVAL || '*/5 * * * *', // cron format
    fullSyncDays: parseInt(process.env.FULL_SYNC_DAYS || '30'), // days
  },

  // Logging
  logging: {
    enableQueryLogging: process.env.DB_QUERY_LOG === 'true',
    enableErrorLogging: process.env.DB_ERROR_LOG === 'true',
  },
}));

// ============================================================================
// 8. ENVIRONMENT VARIABLES (.env.example)
// ============================================================================

/*
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/kimai_sync?schema=public"
DB_TIMEOUT=10000
DB_IDLE_TIMEOUT=30000

# Redis (for BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379

# Sync Configuration
SYNC_INTERVAL="*/5 * * * *"     # Every 5 minutes
FULL_SYNC_DAYS=30               # Full sync every 30 days

# Logging
DB_QUERY_LOG=false
DB_ERROR_LOG=true

# Kimai API
KIMAI_URL=https://kimai.example.com
KIMAI_API_KEY=your-api-key

# Notion API
NOTION_API_KEY=your-notion-api-key
*/

// ============================================================================
// USAGE SUMMARY
// ============================================================================

/*
 * DEPENDENCY INJECTION FLOW:
 *
 * 1. Import DatabaseModule in your modules:
 *    @Module({
 *      imports: [DatabaseModule],
 *      providers: [SyncService],
 *    })
 *
 * 2. Inject DatabaseService:
 *    constructor(private db: DatabaseService) {}
 *
 * 3. Use database methods:
 *    const entries = await this.db.getUnsyncedEntriesInRange(start, end);
 *    await this.db.batchMarkEntriesSynced(ids);
 *
 * =========================================================================
 * JOB QUEUE FLOW:
 *
 * 1. Endpoint: POST /sync/full
 * 2. Controller adds job to queue: syncQueue.add('sync-full', ...)
 * 3. BullMQ picks up job from Redis
 * 4. SyncJobHandler.handleFullSync() executes
 * 5. Calls SyncService.syncFullHistory()
 * 6. DatabaseService performs upserts, updates
 * 7. Job completed or retried on failure
 *
 * =========================================================================
 * SCHEDULED SYNC FLOW:
 *
 * 1. App starts → ScheduledSyncProvider.onModuleInit()
 * 2. Cron job registered: "every 5 minutes"
 * 3. Every 5 min: Add 'sync-weekly' job to queue
 * 4. BullMQ processes job → SyncJobHandler.handleWeeklySync()
 * 5. SyncService.syncCurrentWeek() executes
 * 6. Finds unsynced entries in current week
 * 7. Marks them synced in database
 *
 * =========================================================================
 * DATABASE OPERATION PATTERNS:
 *
 * Pattern 1: Idempotent Upsert (safe to re-run)
 *   const entry = await this.db.upsertTimeEntry(kimaiId, projectId, data);
 *
 * Pattern 2: Weekly Query (find unsync'd entries)
 *   const entries = await this.db.getUnsyncedEntriesInRange(start, end);
 *
 * Pattern 3: Batch Update (efficient)
 *   const count = await this.db.batchMarkEntriesSynced(entryIds);
 *
 * Pattern 4: Transaction (atomic multiple operations)
 *   const result = await this.db.syncProjectAtomic(projectId, entries, start, end);
 *
 * =========================================================================
 * MONITORING:
 *
 * 1. Sync Statistics:
 *    const stats = await this.db.getSyncStats();
 *    console.log(stats); // { total: 1000, synced: 850, unsynced: 150 }
 *
 * 2. Project-specific stats:
 *    const stats = await this.db.getSyncStatsByProject(projectId);
 *
 * 3. Unsynced count:
 *    const count = await this.db.countUnsynced();
 */
