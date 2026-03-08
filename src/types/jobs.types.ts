// Job Types
export interface SyncJobData {
  startDate?: Date;
  endDate?: Date;
  userId?: string;
}

export interface JobResult {
  success: boolean;
  synced: number;
  failed: number;
  timestamp: Date;
  error?: string;
}
