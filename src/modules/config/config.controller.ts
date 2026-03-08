import { Controller, Get, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface Config {
  kimaiUrl: string;
  kimaiApiKey: string;
  notionApiKey: string;
  syncInterval: string;
  syncEnabled: boolean;
  lastUpdatedAt: string;
}

@Controller('config')
export class ConfigController {
  constructor(private configService: ConfigService) {}

  @Get()
  getConfig(): Partial<Config> {
    return {
      kimaiUrl: this.configService.get<string>('kimai.url', ''),
      kimaiApiKey: this.configService.get<string>('kimai.apiKey', '') ? '***hidden***' : '',
      notionApiKey: this.configService.get<string>('notion.apiKey', '') ? '***hidden***' : '',
      syncInterval: this.configService.get<string>('sync.interval', '*/5 * * * *'),
      syncEnabled: this.configService.get<boolean>('sync.enabled', true),
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  @Post()
  saveConfig(@Body() config: Config) {
    if (!config.kimaiUrl) {
      throw new HttpException('Kimai URL is required', HttpStatus.BAD_REQUEST);
    }

    if (!config.syncInterval) {
      throw new HttpException('Sync interval is required', HttpStatus.BAD_REQUEST);
    }

    const cronParts = config.syncInterval.trim().split(/\s+/);
    if (cronParts.length < 5) {
      throw new HttpException('Invalid cron expression format', HttpStatus.BAD_REQUEST);
    }

    console.log('Config saved:', {
      kimaiUrl: config.kimaiUrl,
      syncInterval: config.syncInterval,
      syncEnabled: config.syncEnabled,
      lastUpdatedAt: config.lastUpdatedAt,
    });

    return {
      success: true,
      message: 'Configuration saved successfully',
      config: {
        ...config,
        kimaiApiKey: '***hidden***',
        notionApiKey: '***hidden***',
      },
    };
  }
}
