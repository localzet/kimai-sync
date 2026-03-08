import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotionClient } from './notion.client';
import { PrismaService } from '../database/prisma.service';
import type { NotionTemplate, NotionPagePayload } from '../../types/notion.types';
import type { KimaiTimeEntry } from '../../types/kimai.types';

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

    async syncEntry(entry: KimaiTimeEntry): Promise<{ pageId: string; pageUrl: string } | null> {
        const project = await this.prisma.project.findUnique({
            where: { kimaiId: entry.project },
        });

        if (!project) {
            this.logger.warn(
                `⚠️ Project ${entry.project} not found, skipping sync`,
            );
            return null;
        }

        try {
            // Validate database configuration
            if (!this.defaultDatabaseId) {
                this.logger.error(
                    `❌ NOTION_DATABASE_ID not configured in env. Set it to enable Notion sync.`,
                );
                return null;
            }

            // Load template if exists, otherwise use defaults
            let propertyMap = {
                title: 'Name',
                date: 'Date',
                duration: 'Duration',
                activity: 'Activity',
                project: 'Project',
                kimaiId: 'Kimai ID',
                tags: 'Tags',
            };

            if (project.notionTemplate) {
                const templateConfig = project.notionTemplate as any;
                this.logger.debug(`Using template for project ${entry.project}`);
                propertyMap = templateConfig?.propertyMap || templateConfig;
            } else {
                this.logger.debug(`No template for project ${entry.project}, using default property names`);
            }

            // 5. Check if page already exists in Notion by Kimai ID
            const existingPages = await this.client.queryDatabase(this.defaultDatabaseId, {
                property: propertyMap.kimaiId,
                number: {
                    equals: entry.id,
                },
            });

            if (existingPages.length > 0) {
                const page = existingPages[0];
                this.logger.log(
                    `✅ Found existing page in Notion for entry ${entry.id}, updating... (page: ${page.id})`,
                );

                // Update existing page with current data
                const updatePayload = this.buildPagePayload(entry, propertyMap, this.defaultDatabaseId);
                await this.client.updatePage(page.id, updatePayload);

                // Update our DB to track this mapping
                await this.prisma.timeEntry.update({
                    where: { kimaiId: entry.id },
                    data: {
                        notionPageId: page.id,
                        notionPageUrl: page.url || `https://notion.so/${page.id.replace(/-/g, '')}`,
                    },
                }).catch(() => {
                    // Ignore errors if entry doesn't exist in our DB yet
                });
                return {
                    pageId: page.id,
                    pageUrl: page.url || `https://notion.so/${page.id.replace(/-/g, '')}`,
                };
            }

            // 6. Create new page in Notion
            const payload = this.buildPagePayload(entry, propertyMap, this.defaultDatabaseId);
            const newPage = await this.client.createPage(payload);
            this.logger.log(
                `✅ Created new page in Notion for entry ${entry.id} (project: ${project.name}, page: ${newPage.id})`,
            );
            return {
                pageId: newPage.id,
                pageUrl: newPage.url || `https://notion.so/${newPage.id.replace(/-/g, '')}`,
            };
        } catch (error: unknown) {
            // Non-critical error, log but don't throw
            const err = error instanceof Error ? error : new Error(String(error));
            this.logger.error(`❌ Failed to sync entry ${entry.id} to Notion`, err.message);
            return null;
        }
    }

    private buildPagePayload(entry: any, propertyMap: Record<string, string>, databaseId: string): NotionPagePayload {
        const durationHours = Math.round((entry.duration / 3600) * 10) / 10;

        const getTagsArray = (tags: any): string[] => {
            if (!tags) return [];
            if (typeof tags === 'string') {
                try {
                    const parsed = JSON.parse(tags);
                    if (Array.isArray(parsed)) {
                        return parsed.filter((t) => t && typeof t === 'string');
                    }
                    return [tags];
                } catch {
                    return [tags];
                }
            }
            if (Array.isArray(tags)) {
                return tags.filter((t) => t && typeof t === 'string');
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
            [propertyMap.project]: {
                select: {
                    name: entry.projectName || 'Unknown Project',
                },
            },
            [propertyMap.kimaiId]: {
                number: entry.id,
            },
        };

        if (propertyMap.tags && entry.tags) {
            const tagsArray = getTagsArray(entry.tags);
            if (tagsArray.length > 0) {
                properties[propertyMap.tags] = {
                    multi_select: tagsArray.map((tag) => ({ name: tag })),
                };
            }
        }

        this.logger.debug(`Final properties:`, JSON.stringify(Object.keys(properties), null, 2));

        return {
            parent: {
                database_id: databaseId,
            },
            properties,
        };
    }
}
