import { registerAs } from '@nestjs/config';

export const kimaiConfig = registerAs('kimai', () => ({
  url: process.env.KIMAI_URL || 'http://localhost:8000',
  apiKey: process.env.KIMAI_API_KEY || '',
  timeout: 30000, // 30 seconds
  retries: 3,
  retryDelay: 1000, // 1 second
}));
