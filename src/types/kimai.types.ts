export interface KimaiTimeEntry {
  id: number;
  project: number;
  activity: number;
  description?: string;
  begin: string; // ISO 8601
  end: string;   // ISO 8601
  duration: number; // seconds
  tags?: string[];
}

export class KimaiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public originalError?: Error,
  ) {
    super(message);
    this.name = 'KimaiError';
  }
}
