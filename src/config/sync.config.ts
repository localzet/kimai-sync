import { registerAs } from '@nestjs/config';

export const syncConfig = registerAs('sync', () => ({
  enabled: process.env.SYNC_ENABLED !== 'false',
  interval: process.env.SYNC_INTERVAL || '*/5 * * * *', // Every 5 minutes
  fullSyncWindow: 3 * 365 * 24 * 60 * 60 * 1000, // 3 years in milliseconds
}));
