import { registerAs } from '@nestjs/config';

export const notionConfig = registerAs('notion', () => ({
  apiKey: process.env.NOTION_API_KEY || '',
  databaseId: process.env.NOTION_DATABASE_ID || '',
  notionVersion: '2022-06-28',
  timeout: 30000, // 30 seconds
}));
