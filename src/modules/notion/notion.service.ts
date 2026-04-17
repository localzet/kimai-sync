import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotionClient } from './notion.client';
import { PrismaService } from '../database/prisma.service';
import type { NotionPagePayload } from '../../types/notion.types';
import type { KimaiTimeEntry } from '../../types/kimai.types';
import { NotionError } from '../../types/notion.types';

type PropertyMap = {
  title: string;
  date: string;
  duration: string;
  activity: string;
  project?: string;
  kimaiId: string;
  tags?: string;
};

@Injectable()
export class NotionService {
  private readonly logger = new Logger(NotionService.name);
  private readonly defaultDatabaseId: string;

  constructor(
    private readonly client: NotionClient,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.defaultDatabaseId = this.config.get<string>('notion.databaseId')!;
  }

  async syncEntry(
    entry: KimaiTimeEntry & { projectName?: string; activityName?: string },
    options?: { notionPageId?: string | null; notionTemplate?: unknown },
  ): Promise<{ pageId: string; pageUrl: string } | null> {
    try {
      if (!this.defaultDatabaseId) {
        this.logger.error('❌ NOTION_DATABASE_ID not configured in env. Set it to enable Notion sync.');
        return null;
      }

      const propertyMap = this.resolvePropertyMap(options?.notionTemplate);
      const updatePayload = this.buildUpdatePayload(entry, propertyMap);

      if (options?.notionPageId) {
        const mappedPage = await this.tryUpdateMappedPage(options.notionPageId, updatePayload, entry.id);
        if (mappedPage) {
          return mappedPage;
        }
      }

      const existingPages = await this.client.queryDatabase(this.defaultDatabaseId, {
        property: propertyMap.kimaiId,
        number: {
          equals: entry.id,
        },
      });

      if (existingPages.length > 0) {
        const primaryPage = existingPages[0];
        this.logger.log(
          `✅ Found ${existingPages.length} page(s) in Notion for entry ${entry.id}, updating ${primaryPage.id}`,
        );

        const updatedPage = await this.client.updatePage(primaryPage.id, updatePayload);
        await this.archiveDuplicatePages(existingPages.slice(1), entry.id, primaryPage.id);

        return this.updateLocalMapping(entry.id, updatedPage.id, updatedPage.url || primaryPage.url);
      }

      const createPayload = this.buildCreatePayload(entry, propertyMap, this.defaultDatabaseId);
      const newPage = await this.client.createPage(createPayload);
      this.logger.log(`✅ Created new page in Notion for entry ${entry.id} (page: ${newPage.id})`);

      return this.updateLocalMapping(entry.id, newPage.id, newPage.url);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`❌ Failed to sync entry ${entry.id} to Notion`, err.message);
      return null;
    }
  }

  private resolvePropertyMap(template: unknown): PropertyMap {
    const defaults: PropertyMap = {
      title: 'Name',
      date: 'Date',
      duration: 'Duration',
      activity: 'Activity',
      project: 'Project',
      kimaiId: 'Kimai ID',
      tags: 'Tags',
    };

    if (!template) {
      return defaults;
    }

    const templateConfig = template as any;
    return {
      ...defaults,
      ...(templateConfig?.propertyMap || templateConfig),
    };
  }

  private async tryUpdateMappedPage(
    notionPageId: string,
    payload: { properties: Record<string, any> },
    kimaiId: number,
  ): Promise<{ pageId: string; pageUrl: string } | null> {
    try {
      const updatedPage = await this.client.updatePage(notionPageId, payload);
      this.logger.debug(`Updated mapped Notion page ${notionPageId} for entry ${kimaiId}`);
      return this.updateLocalMapping(kimaiId, updatedPage.id, updatedPage.url);
    } catch (error) {
      if (!(error instanceof NotionError) || ![404, 409].includes(error.statusCode ?? 0)) {
        throw error;
      }

      this.logger.warn(
        `Mapped Notion page ${notionPageId} for entry ${kimaiId} is unavailable, fallback to search`,
      );
      await this.clearLocalMapping(kimaiId);
      return null;
    }
  }

  private async archiveDuplicatePages(pages: any[], kimaiId: number, keepPageId: string): Promise<void> {
    for (const page of pages) {
      if (!page?.id || page.id === keepPageId) {
        continue;
      }

      try {
        await this.client.archivePage(page.id);
        this.logger.warn(`Archived duplicate Notion page ${page.id} for entry ${kimaiId}; kept ${keepPageId}`);
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error(`Failed to archive duplicate page ${page.id} for entry ${kimaiId}`, err.message);
      }
    }
  }

  private async clearLocalMapping(kimaiId: number): Promise<void> {
    await this.prisma.timeEntry.update({
      where: { kimaiId },
      data: {
        notionPageId: null,
        notionPageUrl: null,
        synced: false,
        syncedAt: null,
      },
    }).catch(() => undefined);
  }

  private async updateLocalMapping(
    kimaiId: number,
    pageId: string,
    pageUrl?: string,
  ): Promise<{ pageId: string; pageUrl: string }> {
    const resolvedUrl = pageUrl || `https://notion.so/${pageId.replace(/-/g, '')}`;

    await this.prisma.timeEntry.update({
      where: { kimaiId },
      data: {
        notionPageId: pageId,
        notionPageUrl: resolvedUrl,
      },
    }).catch(() => undefined);

    return {
      pageId,
      pageUrl: resolvedUrl,
    };
  }

  private buildCreatePayload(entry: KimaiTimeEntry & { projectName?: string; activityName?: string }, propertyMap: PropertyMap, databaseId: string): NotionPagePayload {
    return {
      parent: {
        database_id: databaseId,
      },
      properties: this.buildProperties(entry, propertyMap),
    };
  }

  private buildUpdatePayload(
    entry: KimaiTimeEntry & { projectName?: string; activityName?: string },
    propertyMap: PropertyMap,
  ): { properties: Record<string, any> } {
    return {
      properties: this.buildProperties(entry, propertyMap),
    };
  }

  private buildProperties(
    entry: KimaiTimeEntry & { projectName?: string; activityName?: string },
    propertyMap: PropertyMap,
  ): Record<string, any> {
    const durationHours = Math.round((entry.duration / 3600) * 10) / 10;

    const getTagsArray = (tags: unknown): string[] => {
      if (!tags) return [];
      if (typeof tags === 'string') {
        try {
          const parsed = JSON.parse(tags);
          if (Array.isArray(parsed)) {
            return parsed.filter((tag): tag is string => Boolean(tag) && typeof tag === 'string');
          }
          return [tags];
        } catch {
          return [tags];
        }
      }
      if (Array.isArray(tags)) {
        return tags.filter((tag): tag is string => Boolean(tag) && typeof tag === 'string');
      }
      return [];
    };

    const properties: Record<string, any> = {
      [propertyMap.title]: {
        title: [
          {
            text: {
              content: entry.description || entry.activityName || 'Unknown Activity',
            },
          },
        ],
      },
      [propertyMap.date]: {
        date: {
          start: entry.begin,
          end: entry.end,
        },
      },
      [propertyMap.duration]: {
        number: durationHours,
      },
      [propertyMap.activity]: {
        rich_text: [
          {
            text: {
              content: entry.activityName || 'Unknown Activity',
            },
          },
        ],
      },
      [propertyMap.kimaiId]: {
        number: entry.id,
      },
    };

    if (propertyMap.project) {
      properties[propertyMap.project] = {
        select: {
          name: entry.projectName || 'Unknown Project',
        },
      };
    }

    if (propertyMap.tags && entry.tags) {
      const tagsArray = getTagsArray(entry.tags);
      if (tagsArray.length > 0) {
        properties[propertyMap.tags] = {
          multi_select: tagsArray.map((tag) => ({ name: tag })),
        };
      }
    }

    this.logger.debug(`Final properties: ${JSON.stringify(Object.keys(properties))}`);

    return properties;
  }
}
