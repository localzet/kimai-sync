// Sync Types
export interface SyncResult {
  synced: number;
  failed: number;
  timestamp: Date;
  duration: number; // milliseconds
}

export interface SyncRequest {
  startDate: Date;
  endDate: Date;
  projectId?: number;
}

export interface TimeEntrySyncPayload {
  kimaiId: number;
  projectId: number;
  activity: string;
  description?: string;
  begin: Date;
  end: Date;
  duration: number;
}

export interface NotionSyncPayload {
  timeEntryId: number;
  pageId: string;
}

export class SyncError extends Error {
  constructor(
    message: string,
    public phase: 'fetch' | 'process' | 'persist' | 'notify',
    public recoverable: boolean = true,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}
