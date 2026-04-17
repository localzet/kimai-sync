import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { NotionPagePayload } from '../../types/notion.types';
import { NotionError } from '../../types/notion.types';

@Injectable()
export class NotionClient {
  private readonly logger = new Logger(NotionClient.name);
  private readonly apiKey: string;
  private readonly notionVersion: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.apiKey = this.config.get<string>('notion.apiKey')!;
    this.notionVersion = this.config.get<string>('notion.notionVersion')!;
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Notion-Version': this.notionVersion,
      'Content-Type': 'application/json',
    };
  }

  async createPage(payload: NotionPagePayload): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.http.post('https://api.notion.com/v1/pages', payload, {
          headers: this.getHeaders(),
        }),
      );
      return response.data;
    } catch (error: unknown) {
      const axiosError = error as any;
      const statusCode = axiosError.response?.status;
      const message = axiosError.response?.data?.message || 'Failed to create page';
      this.logger.error(`❌ Notion error (${statusCode}): ${message}`, axiosError.response?.data);
      throw new NotionError(message, statusCode, axiosError as Error);
    }
  }

  async updatePage(pageId: string, payload: Record<string, any>): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.http.patch(`https://api.notion.com/v1/pages/${pageId}`, payload, {
          headers: this.getHeaders(),
        }),
      );
      return response.data;
    } catch (error: unknown) {
      const axiosError = error as any;
      const statusCode = axiosError.response?.status;
      const message = axiosError.response?.data?.message || 'Failed to update page';
      throw new NotionError(message, statusCode, axiosError as Error);
    }
  }

  async getPage(pageId: string): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.http.get(`https://api.notion.com/v1/pages/${pageId}`, {
          headers: this.getHeaders(),
        }),
      );
      return response.data;
    } catch (error: unknown) {
      const axiosError = error as any;
      const statusCode = axiosError.response?.status;
      const message = axiosError.response?.data?.message || 'Failed to fetch page';
      throw new NotionError(message, statusCode, axiosError as Error);
    }
  }

  async archivePage(pageId: string): Promise<any> {
    return this.updatePage(pageId, { archived: true });
  }

  async getDatabase(databaseId: string): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.http.get(`https://api.notion.com/v1/databases/${databaseId}`, {
          headers: this.getHeaders(),
        }),
      );
      return response.data;
    } catch (error: unknown) {
      const axiosError = error as any;
      throw new NotionError('Failed to fetch database', axiosError.response?.status, axiosError as Error);
    }
  }

  async queryDatabase(
    databaseId: string,
    filter: Record<string, any>,
  ): Promise<any[]> {
    try {
      const response = await firstValueFrom(
        this.http.post(
          `https://api.notion.com/v1/databases/${databaseId}/query`,
          { filter },
          {
            headers: this.getHeaders(),
          },
        ),
      );
      return response.data.results || [];
    } catch (error: unknown) {
      const axiosError = error as any;
      const statusCode = axiosError.response?.status;
      const message = axiosError.response?.data?.message || 'Failed to query database';
      this.logger.error(`❌ Notion query error (${statusCode}): ${message}`);
      return [];
    }
  }
}
