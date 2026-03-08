import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KimaiService } from '@modules/kimai/kimai.service';
import { PrismaService } from '@modules/database/prisma.service';
import { NotionService } from '@modules/notion/notion.service';
import type { KimaiTimeEntry } from '../../types/kimai.types';
import { SyncResult, TimeEntrySyncPayload, SyncError } from '../../types/sync.types';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly kimai: KimaiService,
    private readonly prisma: PrismaService,
    private readonly notion: NotionService,
    private readonly config: ConfigService,
  ) {}

  async syncFullHistory(): Promise<SyncResult> {
    this.logger.log('🔄 Starting full history sync (last 3 years)...');
    const startTime = Date.now();

    try {
      // 1. First sync all projects
      await this.syncProjects();

      // 2. Then sync activities
      await this.syncActivities();

      // 3. Then sync time entries
      const end = new Date();
      const start = new Date(end);
      start.setFullYear(start.getFullYear() - 3);

      const entries = await this.kimai.getTimeEntries(start, end);
      const result = await this.processEntries(entries);

      const duration = Date.now() - startTime;
      this.logger.log(
        `✅ Full sync completed: ${result.synced} synced, ${result.failed} failed (${duration}ms)`,
      );

      return {
        synced: result.synced,
        failed: result.failed,
        timestamp: new Date(),
        duration,
      };
    } catch (error) {
      this.logger.error('❌ Full sync failed', error);
      throw new SyncError('Full history sync failed', 'fetch', false);
    }
  }

  async syncCurrentWeek(): Promise<SyncResult> {
    this.logger.log('📅 Starting weekly sync (current week)...');
    const startTime = Date.now();

    try {
      // 1. First sync all projects
      await this.syncProjects();

      // 2. Then sync activities
      await this.syncActivities();

      // 3. Then sync time entries
      const end = new Date();
      const start = this.getMonday(end);

      const entries = await this.kimai.getRecentEntries(7); // Last 7 days
      const result = await this.processEntries(entries);

      const duration = Date.now() - startTime;
      this.logger.log(
        `✅ Weekly sync completed: ${result.synced} synced, ${result.failed} failed (${duration}ms)`,
      );

      return {
        synced: result.synced,
        failed: result.failed,
        timestamp: new Date(),
        duration,
      };
    } catch (error) {
      this.logger.error('❌ Weekly sync failed', error);
      throw new SyncError('Weekly sync failed', 'fetch', true);
    }
  }

  private async syncProjects(): Promise<void> {
    try {
      this.logger.log('📦 Syncing projects...');
      const projects = await this.kimai.getProjects();

      for (const kimaiProject of projects) {
        await this.prisma.project.upsert({
          where: { kimaiId: kimaiProject.id },
          update: {
            name: kimaiProject.name,
            isActive: kimaiProject.active,
          },
          create: {
            kimaiId: kimaiProject.id,
            name: kimaiProject.name,
            isActive: kimaiProject.active,
          },
        });
      }
      this.logger.log(`✅ Synced ${projects.length} projects`);
    } catch (error) {
      this.logger.error('❌ Failed to sync projects', error);
      throw error;
    }
  }

  private async syncActivities(): Promise<void> {
    try {
      this.logger.log('📦 Syncing activities...');
      const activities = await this.kimai.getActivities();

      for (const kimaiActivity of activities) {
        await this.prisma.activity.upsert({
          where: { kimaiId: kimaiActivity.id },
          update: {
            name: kimaiActivity.name,
            isActive: kimaiActivity.active,
          },
          create: {
            kimaiId: kimaiActivity.id,
            name: kimaiActivity.name,
            isActive: kimaiActivity.active,
          },
        });
      }
      this.logger.log(`✅ Synced ${activities.length} activities`);
    } catch (error) {
      this.logger.error('❌ Failed to sync activities', error);
      throw error;
    }
  }

  private async processEntries(entries: KimaiTimeEntry[]): Promise<{
    synced: number;
    failed: number;
  }> {
    let synced = 0;
    let failed = 0;

    for (const entry of entries) {
      try {
        // 1. Find project by ID (should exist from syncProjects)
        const project = await this.prisma.project.findUnique({
          where: { kimaiId: entry.project },
        });

        if (!project) {
          this.logger.warn(
            `⚠️ Project ID ${entry.project} not found - skipping entry ${entry.id}`,
          );
          failed++;
          continue;
        }

        // 2. Find activity by ID (should exist from syncActivities)
        let activityName = 'Unknown Activity';
        if (entry.activity) {
          const activity = await this.prisma.activity.findUnique({
            where: { kimaiId: entry.activity },
          });
          if (activity) {
            activityName = activity.name;
          } else {
            this.logger.warn(
              `⚠️ Activity ID ${entry.activity} not found in DB - using fallback`,
            );
          }
        }

        // 3. Upsert time entry (idempotent)
        const description = entry.description || '';
        
        await this.prisma.timeEntry.upsert({
          where: { kimaiId: entry.id },
          update: {
            activity: activityName,
            description: description,
            begin: new Date(entry.begin),
            end: new Date(entry.end),
            duration: entry.duration,
            tags: entry.tags ? (Array.isArray(entry.tags) ? JSON.stringify(entry.tags) : entry.tags) : null,
          },
          create: {
            kimaiId: entry.id,
            projectId: project.id,
            activity: activityName,
            description: description,
            begin: new Date(entry.begin),
            end: new Date(entry.end),
            duration: entry.duration,
            tags: entry.tags ? (Array.isArray(entry.tags) ? JSON.stringify(entry.tags) : entry.tags) : null,
          },
        });

        // 4. Sync to Notion (async, non-blocking, only if enabled)
        if (project.notionEnabled) {
          // Create enriched entry with resolved names for Notion
          const enrichedEntry = {
            ...entry,
            projectName: project.name,
            activityName: activityName,
          };
          
          const notionResult = await this.notion.syncEntry(enrichedEntry as any);
          if (notionResult) {
            // Update time entry with Notion sync info
            await this.prisma.timeEntry.update({
              where: { kimaiId: entry.id },
              data: {
                synced: true,
                syncedAt: new Date(),
                notionPageId: notionResult.pageId,
                notionPageUrl: notionResult.pageUrl,
              },
            });
            this.logger.debug(`📌 Marked time entry ${entry.id} as synced`);
          }
        } else {
          this.logger.debug(`⏭️ Skipping Notion sync for entry ${entry.id} (disabled for project)`);
        }

        synced++;
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error(`❌ Failed to process entry ${entry.id}`, err.message);
        failed++;
      }
    }

    return { synced, failed };
  }

  private getMonday(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  }
}
