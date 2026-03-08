import { Injectable, Logger } from '@nestjs/common';
import { KimaiClient } from './kimai.client';
import type { KimaiTimeEntry } from '../../types/kimai.types';

@Injectable()
export class KimaiService {
  private readonly logger = new Logger(KimaiService.name);

  constructor(private readonly client: KimaiClient) {}

  async getTimeEntries(start: Date, end: Date): Promise<KimaiTimeEntry[]> {
    this.logger.log(`📥 Fetching Kimai entries from ${start.toISOString()} to ${end.toISOString()}`);

    const startStr = start.toISOString().split('.')[0];
    const endStr = end.toISOString().split('.')[0];

    const entries: KimaiTimeEntry[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      try {
        const pageEntries = await this.client.getTimeEntries(startStr, endStr, 100, page);

        if (pageEntries.length === 0) {
          hasMore = false;
          break;
        }

        entries.push(...pageEntries);
        page++;

        await this.delay(500);
      } catch (error) {
        this.logger.error(`❌ Error fetching page ${page}`, error);
        throw error;
      }
    }

    this.logger.log(`✅ Fetched ${entries.length} total entries`);
    return entries;
  }

  async getRecentEntries(days: number = 7): Promise<KimaiTimeEntry[]> {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - days);

    return this.getTimeEntries(start, end);
  }

  async getProjects(): Promise<any[]> {
    this.logger.log('🔍 Fetching all Kimai projects...');
    try {
      const projects = await this.client.getProjects();
      this.logger.log(`✅ Fetched ${projects.length} projects`);
      return projects;
    } catch (error) {
      this.logger.error('❌ Failed to fetch projects', error);
      throw error;
    }
  }

  async getActivities(): Promise<any[]> {
    this.logger.log('🔍 Fetching all Kimai activities...');
    try {
      const activities = await this.client.getActivities();
      this.logger.log(`✅ Fetched ${activities.length} activities`);
      return activities;
    } catch (error) {
      this.logger.error('❌ Failed to fetch activities', error);
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
