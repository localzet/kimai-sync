import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { KimaiTimeEntry } from '../../types/kimai.types';
import { KimaiError } from '../../types/kimai.types';

@Injectable()
export class KimaiClient {
    private readonly logger = new Logger(KimaiClient.name);
    private readonly baseUrl: string;
    private readonly apiKey: string;
    private readonly timeout: number;
    private readonly maxRetries: number = 3;

    constructor(
        private readonly http: HttpService,
        private readonly config: ConfigService,
    ) {
        this.baseUrl = this.config.get<string>('kimai.url')!;
        this.apiKey = this.config.get<string>('kimai.apiKey')!;
        this.timeout = this.config.get<number>('kimai.timeout')!;
    }

    private getHeaders(): Record<string, string> {
        return {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
        };
    }

    async getTimeEntries(
        start: string,
        end: string,
        limit: number = 100,
        page: number = 1,
    ): Promise<KimaiTimeEntry[]> {
        let retries = 0;

        while (retries < this.maxRetries) {
            try {
                const response = await firstValueFrom(
                    this.http.get(`${this.baseUrl}/api/timesheets`, {
                        headers: this.getHeaders(),
                        params: {
                            page,
                            size: limit,
                            begin: start,
                            end: end,
                        },
                        timeout: this.timeout,
                    }),
                );

                this.logger.debug(`✅ Fetched ${response.data.length} entries (page ${page})`);

                return response.data.map((item: any) => ({
                    id: item.id,
                    project: item.project,
                    activity: item.activity,
                    begin: item.begin,
                    end: item.end,
                    duration: item.duration,
                    description: item.description,
                    tags: item.tags,
                }))
            } catch (error: unknown) {
                const axiosError = error as any;

                if (axiosError.response?.status === 404) {
                    this.logger.debug(`⏹️ End of pagination reached at page ${page}`);
                    return [];
                }

                retries++;
                if (retries >= this.maxRetries) {
                    const message = `❌ Failed to fetch timesheets after ${this.maxRetries} retries`;
                    this.logger.error(message, error);
                    throw new KimaiError(message, axiosError.response?.status, axiosError as Error);
                }
                await this.delay(1000 * retries);
            }
        }

        return [];
    }

    async getProjects(): Promise<any[]> {
        try {
            const response = await firstValueFrom(
                this.http.get(`${this.baseUrl}/api/projects`, {
                    headers: this.getHeaders(),
                    timeout: this.timeout,
                }),
            );
            return response.data;
        } catch (error: unknown) {
            const axiosError = error as any;
            throw new KimaiError('Failed to fetch projects', axiosError.response?.status, axiosError as Error);
        }
    }

    async getActivities(): Promise<any[]> {
        try {
            const response = await firstValueFrom(
                this.http.get(`${this.baseUrl}/api/activities`, {
                    headers: this.getHeaders(),
                    timeout: this.timeout,
                }),
            );
            return response.data;
        } catch (error: unknown) {
            const axiosError = error as any;
            throw new KimaiError('Failed to fetch projects', axiosError.response?.status, axiosError as Error);
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
