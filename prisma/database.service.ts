/**
 * Prisma Database Service for Kimai Sync
 * 
 * Provides type-safe database operations for the sync application.
 * Contains utility methods for common patterns used in sync jobs.
 * 
 * Usage:
 * - Inject into NestJS services: constructor(private db: DatabaseService) {}
 * - Use for idempotent upserts, weekly sync queries, and Notion integration
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, Project, TimeEntry, Prisma } from '@prisma/client';

interface SyncStats {
  total: number;
  synced: number;
  unsynced: number;
  lastSyncedAt?: Date;
}

interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  // Connect to database on module initialization
  async connect() {
    try {
      await this.prisma.$connect();
      this.logger.log('Connected to PostgreSQL');
    } catch (error) {
      this.logger.error('Database connection failed', error);
      throw error;
    }
  }

  // Gracefull shutdown
  async disconnect() {
    await this.prisma.$disconnect();
    this.logger.log('Disconnected from PostgreSQL');
  }

  // =========================================================================
  // PROJECT OPERATIONS
  // =========================================================================

  /**
   * Create or update a project based on Kimai data
   * Safe to call multiple times (idempotent by kimaiId)
   */
  async upsertProject(
    kimaiProject: { id: number; name: string; description?: string },
    notionDatabaseId?: string,
  ): Promise<Project> {
    return this.prisma.project.upsert({
      where: { kimaiId: kimaiProject.id },
      update: {
        name: kimaiProject.name,
        description: kimaiProject.description || null,
        notionDatabaseId: notionDatabaseId || null,
        lastSyncedAt: new Date(),
      },
      create: {
        kimaiId: kimaiProject.id,
        name: kimaiProject.name,
        description: kimaiProject.description || null,
        notionDatabaseId: notionDatabaseId || null,
        isActive: true,
      },
    });
  }

  /**
   * Find project by Kimai ID
   */
  async getProjectByKimaiId(kimaiId: number): Promise<Project | null> {
    return this.prisma.project.findUnique({
      where: { kimaiId },
    });
  }

  /**
   * Find project by database ID (primary key)
   */
  async getProjectById(id: number): Promise<Project | null> {
    return this.prisma.project.findUnique({
      where: { id },
    });
  }

  /**
   * List all active projects
   */
  async getActiveProjects(): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  // =========================================================================
  // TIME ENTRY OPERATIONS
  // =========================================================================

  /**
   * Create or update time entry based on Kimai data
   * Idempotent: safe to call multiple times with same kimaiId
   */
  async upsertTimeEntry(
    kimaiId: number,
    projectId: number,
    data: {
      activity: string;
      description?: string;
      tags?: string;
      begin: Date;
      end?: Date;
      duration: number;
    },
  ): Promise<TimeEntry> {
    return this.prisma.timeEntry.upsert({
      where: { kimaiId },
      update: {
        activity: data.activity,
        description: data.description || null,
        tags: data.tags || null,
        begin: data.begin,
        end: data.end || null,
        duration: data.duration,
        updatedAt: new Date(),
      },
      create: {
        kimaiId,
        projectId,
        activity: data.activity,
        description: data.description || null,
        tags: data.tags || null,
        begin: data.begin,
        end: data.end || null,
        duration: data.duration,
        synced: false,
      },
    });
  }

  /**
   * Batch upsert time entries (efficient for sync jobs)
   */
  async batchUpsertTimeEntries(
    entries: Array<{
      kimaiId: number;
      projectId: number;
      activity: string;
      description?: string;
      begin: Date;
      end?: Date;
      duration: number;
    }>,
  ): Promise<SyncResult> {
    const result: SyncResult = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    for (const entry of entries) {
      try {
        const existing = await this.prisma.timeEntry.findUnique({
          where: { kimaiId: entry.kimaiId },
        });

        if (existing) {
          await this.prisma.timeEntry.update({
            where: { kimaiId: entry.kimaiId },
            data: {
              activity: entry.activity,
              description: entry.description || null,
              begin: entry.begin,
              end: entry.end || null,
              duration: entry.duration,
              updatedAt: new Date(),
            },
          });
          result.updated++;
        } else {
          await this.prisma.timeEntry.create({
            data: {
              kimaiId: entry.kimaiId,
              projectId: entry.projectId,
              activity: entry.activity,
              description: entry.description || null,
              begin: entry.begin,
              end: entry.end || null,
              duration: entry.duration,
              synced: false,
            },
          });
          result.created++;
        }
      } catch (error) {
        const err = error instanceof Error ? error.message : String(error);
        result.errors.push(
          `Failed to upsert entry ${entry.kimaiId}: ${err}`,
        );
      }
    }

    return result;
  }

  // =========================================================================
  // SYNC QUERY OPERATIONS (Weekly Sync)
  // =========================================================================

  /**
   * Find all unsynced entries in a date range
   * Uses index: (synced, begin) for efficiency
   */
  async getUnsyncedEntriesInRange(
    weekStart: Date,
    weekEnd: Date,
  ): Promise<TimeEntry[]> {
    return this.prisma.timeEntry.findMany({
      where: {
        synced: false,
        begin: {
          gte: weekStart,
          lt: weekEnd,
        },
      },
      orderBy: {
        begin: 'asc',
      },
    });
  }

  /**
   * Find unsynced entries for a specific project in a date range
   * Uses index: (synced, begin, projectId) for efficiency
   */
  async getUnsyncedEntriesByProjectInRange(
    projectId: number,
    weekStart: Date,
    weekEnd: Date,
  ): Promise<TimeEntry[]> {
    return this.prisma.timeEntry.findMany({
      where: {
        projectId,
        synced: false,
        begin: {
          gte: weekStart,
          lt: weekEnd,
        },
      },
      include: {
        project: true,
      },
      orderBy: {
        begin: 'asc',
      },
    });
  }

  /**
   * Mark entries as synced to Notion
   */
  async markEntriesSynced(
    entryIds: number[],
    notionPageMap?: Map<number, string>,
  ): Promise<number> {
    let syncedCount = 0;

    for (const entryId of entryIds) {
      try {
        const notionPageId = notionPageMap?.get(entryId);
        await this.prisma.timeEntry.update({
          where: { id: entryId },
          data: {
            synced: true,
            syncedAt: new Date(),
            notionPageId: notionPageId || null,
          },
        });
        syncedCount++;
      } catch (error) {
        this.logger.error(`Failed to mark entry ${entryId} as synced:`, error);
      }
    }

    return syncedCount;
  }

  /**
   * Batch mark entries as synced (more efficient)
   */
  async batchMarkEntriesSynced(entryIds: number[]): Promise<number> {
    if (entryIds.length === 0) return 0;

    const result = await this.prisma.timeEntry.updateMany({
      where: {
        id: { in: entryIds },
      },
      data: {
        synced: true,
        syncedAt: new Date(),
      },
    });

    return result.count;
  }

  // =========================================================================
  // HISTORY OPERATIONS (Full Sync - Last 3 Years)
  // =========================================================================

  /**
   * Get all entries for a project from the last 3 years
   * Used for full history sync
   */
  async getFullHistoryForProject(projectId: number): Promise<TimeEntry[]> {
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);

    return this.prisma.timeEntry.findMany({
      where: {
        projectId,
        begin: {
          gte: threeYearsAgo,
        },
      },
      orderBy: {
        begin: 'desc',
      },
    });
  }

  /**
   * Get entries within a specific date range for a project
   */
  async getEntriesInDateRange(
    projectId: number,
    start: Date,
    end: Date,
  ): Promise<TimeEntry[]> {
    return this.prisma.timeEntry.findMany({
      where: {
        projectId,
        begin: {
          gte: start,
          lt: end,
        },
      },
      orderBy: {
        begin: 'desc',
      },
    });
  }

  // =========================================================================
  // STATISTICS & MONITORING
  // =========================================================================

  /**
   * Get sync statistics for monitoring dashboard
   */
  async getSyncStats(): Promise<SyncStats> {
    const [total, synced, lastSyncRecord] = await Promise.all([
      this.prisma.timeEntry.count(),
      this.prisma.timeEntry.count({
        where: { synced: true },
      }),
      this.prisma.timeEntry.findFirst({
        where: { synced: true },
        orderBy: { syncedAt: 'desc' },
      }),
    ]);

    return {
      total,
      synced,
      unsynced: total - synced,
      lastSyncedAt: lastSyncRecord?.syncedAt ?? undefined,
    };
  }

  /**
   * Get sync stats by project
   */
  async getSyncStatsByProject(projectId: number): Promise<SyncStats> {
    const [total, synced, lastSyncRecord] = await Promise.all([
      this.prisma.timeEntry.count({
        where: { projectId },
      }),
      this.prisma.timeEntry.count({
        where: { projectId, synced: true },
      }),
      this.prisma.timeEntry.findFirst({
        where: { projectId, synced: true },
        orderBy: { syncedAt: 'desc' },
      }),
    ]);

    return {
      total,
      synced,
      unsynced: total - synced,
      lastSyncedAt: lastSyncRecord?.syncedAt ?? undefined,
    };
  }

  /**
   * Count entries needing sync
   */
  async countUnsynced(): Promise<number> {
    return this.prisma.timeEntry.count({
      where: { synced: false },
    });
  }

  /**
   * Count unsynced entries in a date range
   */
  async countUnsyncedInRange(
    weekStart: Date,
    weekEnd: Date,
  ): Promise<number> {
    return this.prisma.timeEntry.count({
      where: {
        synced: false,
        begin: {
          gte: weekStart,
          lt: weekEnd,
        },
      },
    });
  }

  // =========================================================================
  // LOOKUP OPERATIONS
  // =========================================================================

  /**
   * Find time entry by Kimai ID
   */
  async getEntryByKimaiId(kimaiId: number): Promise<TimeEntry | null> {
    return this.prisma.timeEntry.findUnique({
      where: { kimaiId },
      include: { project: true },
    });
  }

  /**
   * Find time entry by Notion page ID
   */
  async getEntryByNotionPageId(notionPageId: string): Promise<TimeEntry | null> {
    return this.prisma.timeEntry.findFirst({
      where: { notionPageId },
    });
  }

  /**
   * Get entry with related project
   */
  async getEntryWithProject(id: number): Promise<
    (TimeEntry & { project: Project }) | null
  > {
    return this.prisma.timeEntry.findUnique({
      where: { id },
      include: { project: true },
    });
  }

  // =========================================================================
  // PAGINATION
  // =========================================================================

  /**
   * Get paginated entries for a project
   */
  async getProjectEntriesPaginated(
    projectId: number,
    page: number = 1,
    pageSize: number = 100,
  ) {
    const skip = (page - 1) * pageSize;

    const [entries, total] = await Promise.all([
      this.prisma.timeEntry.findMany({
        where: { projectId },
        skip,
        take: pageSize,
        orderBy: { begin: 'desc' },
      }),
      this.prisma.timeEntry.count({
        where: { projectId },
      }),
    ]);

    return {
      entries,
      total,
      page,
      pageSize,
      pages: Math.ceil(total / pageSize),
    };
  }

  // =========================================================================
  // CLEANUP & MAINTENANCE
  // =========================================================================

  /**
   * Delete orphaned entries (entries with deleted projects)
   * This should not happen with cascading deletes, but for safety
   */
  async cleanupOrphanedEntries(): Promise<number> {
    const result = await this.prisma.$executeRaw`
      DELETE FROM "TimeEntry" 
      WHERE "projectId" NOT IN (SELECT id FROM "Project")
    `;
    return result;
  }

  /**
   * Get database size and stats
   */
  async getDatabaseStats() {
    const stats = await this.prisma.$queryRaw<
      Array<{ relation: string; size: string }>
    >`
      SELECT 
        schemaname || '.' || tablename as relation,
        pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) as size
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC
    `;

    return stats;
  }

  /**
   * Transaction: Atomic full sync for a project
   * All queries succeed together or all fail
   */
  async syncProjectAtomic(
    projectId: number,
    entries: Array<{
      kimaiId: number;
      activity: string;
      begin: Date;
      end?: Date;
      duration: number;
    }>,
    weekStart: Date,
    weekEnd: Date,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Remove old entries in this week
      const deleted = await tx.timeEntry.deleteMany({
        where: {
          projectId,
          begin: {
            gte: weekStart,
            lt: weekEnd,
          },
        },
      });

      // 2. Create fresh entries
      const created = await Promise.all(
        entries.map((entry) =>
          tx.timeEntry.create({
            data: {
              kimaiId: entry.kimaiId,
              projectId,
              activity: entry.activity,
              begin: entry.begin,
              end: entry.end || null,
              duration: entry.duration,
              synced: false,
            },
          }),
        ),
      );

      // 3. Update project sync timestamp
      const updated = await tx.project.update({
        where: { id: projectId },
        data: { lastSyncedAt: new Date() },
      });

      return {
        deleted: deleted.count,
        created: created.length,
        project: updated,
      };
    });
  }
}

/**
 * CONNECTION POOL STRATEGY (for Production)
 *
 * Add connection pooling in production for better performance:
 *
 * 1. Using PgBouncer (recommended):
 *    DATABASE_URL="postgresql://user:pass@pgbouncer-host:6432/kimai_sync"
 *    With pgbouncer.ini:
 *    [databases]
 *    kimai_sync = host=pg-server port=5432 dbname=kimai_sync
 *    [pgbouncer]
 *    pool_mode = transaction
 *    max_client_conn = 1000
 *    default_pool_size = 25
 *
 * 2. Using Prisma Connection Pooling:
 *    DATABASE_URL="postgresql://...?schema=public&connection_limit=10"
 *
 * 3. Manual connection pool in Prisma:
 *    const prisma = new PrismaClient({
 *      log: ['warn', 'error'],
 *      errorFormat: 'pretty',
 *    });
 */
