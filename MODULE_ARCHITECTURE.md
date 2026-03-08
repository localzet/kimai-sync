# Kimai Sync - Complete Module Architecture & Implementation Plan

## 1. Complete Module Organization

```
src/
├── modules/
│   ├── config/                    # Configuration services (environment first)
│   │   ├── kimai.config.ts       # Kimai API configuration
│   │   ├── notion.config.ts      # Notion API configuration  
│   │   ├── database.config.ts    # PostgreSQL/Prisma configuration
│   │   ├── redis.config.ts       # Redis/BullMQ configuration
│   │   └── config.module.ts      # Config module exports all
│   │
│   ├── kimai/                     # Kimai API integration (no dependencies except config)
│   │   ├── kimai.client.ts       # HTTP client wrapper
│   │   ├── kimai.service.ts      # Business logic + retry wrapper
│   │   ├── kimai.types.ts        # Moved here from types/ for proximity
│   │   └── kimai.module.ts
│   │
│   ├── database/                  # Prisma ORM & database access (depends on config)
│   │   ├── prisma.service.ts     # Prisma client + lifecycle
│   │   ├── database.service.ts   # Query helpers (optional)
│   │   └── database.module.ts
│   │
│   ├── sync/                      # Core sync orchestration (depends on kimai, database, notion)
│   │   ├── sync.service.ts       # Main sync logic
│   │   ├── sync.controller.ts    # REST endpoints
│   │   ├── sync.types.ts         # Sync-specific types
│   │   └── sync.module.ts
│   │
│   ├── jobs/                      # BullMQ job handlers + scheduling (depends on sync, config)
│   │   ├── sync-full.job.ts      # Full history sync job handler
│   │   ├── sync-weekly.job.ts    # Weekly sync job handler
│   │   ├── scheduled-sync.provider.ts  # Cron scheduler provider
│   │   ├── jobs.types.ts         # Job queue types
│   │   └── jobs.module.ts
│   │
│   ├── notion/                    # Notion API integration (depends on config)
│   │   ├── notion.client.ts      # HTTP client wrapper
│   │   ├── notion.service.ts     # Template mapping & sync logic
│   │   ├── notion.types.ts       # Moved here for proximity
│   │   └── notion.module.ts
│   │
│   └── health/                    # Health check endpoint
│       ├── health.controller.ts
│       └── health.module.ts
│
├── common/
│   ├── exceptions/
│   │   ├── kimai.exception.ts
│   │   ├── notion.exception.ts
│   │   ├── sync.exception.ts
│   │   └── database.exception.ts
│   │
│   ├── filters/
│   │   ├── exception.filter.ts   # Global exception handler
│   │   └── http-exception.filter.ts
│   │
│   ├── interceptors/
│   │   ├── logging.interceptor.ts     # Request/response logging
│   │   └── error-handling.interceptor.ts
│   │
│   ├── guards/
│   │   └── api-key.guard.ts       # Simple API key validation
│   │
│   └── utils/
│       ├── retry.helper.ts         # Retry wrapper function
│       ├── date.helper.ts          # Date utilities (getMonday, etc)
│       └── logger.service.ts       # Custom logger wrapper
│
├── migrations/                     # Prisma migrations
│   └── migrations/
│
├── app.module.ts                  # Root module
├── main.ts                        # Bootstrap
└── environment.ts                 # Type-safe env parsing
```

---

## 2. Service Responsibilities by Module

### **config/** - Configuration & Initialization
| Service | Responsibility |
|---------|-----------------|
| `KimaiConfig` | Kimai URL, API key, pagination size, timeout settings |
| `NotionConfig` | Notion API key, template database mappings, property names |
| `DatabaseConfig` | PostgreSQL connection string, pool size, SSL settings |
| `RedisConfig` | Redis URL, retry strategy, job options (attempts, backoff) |

**Key Principle**: Configuration is **environment-driven**, not hardcoded. Loaded once at startup.

---

### **kimai/** - External API Client
| Service | Responsibility |
|---------|-----------------|
| `KimaiClient` | HTTP requests (GET /timesheets with pagination) |
| `KimaiService` | Business logic: transform responses, filter by date range, pagination handling, retry wrapper |

**Methods**:
```typescript
KimaiService:
- getTimeEntries(start: Date, end: Date): Promise<KimaiTimeEntry[]>
- getRecentEntries(days: number): Promise<KimaiTimeEntry[]>
- getProjects(): Promise<Project[]>
- healthCheck(): Promise<boolean>
```

**Dependencies**: `HttpService`, `KimaiConfig`

**Error Handling**: 
- Network errors: exponential backoff retry (3 attempts)
- 401/403: throw `KimaiAuthenticationError`
- 404: throw `KimaiNotFoundError`
- Rate limiting: pause and retry after delay

---

### **database/** - Data Persistence
| Service | Responsibility |
|---------|-----------------|
| `PrismaService` | Prisma client lifecycle, connection management |
| (Optional) `DatabaseService` | Helper methods for complex queries |

**Methods** (via Prisma):
```typescript
PrismaService:
- timeEntry.upsert() [idempotent save]
- project.findUnique()/findMany()
- $transaction() [atomic operations]
```

**Dependencies**: `DatabaseConfig`

**Error Handling**:
- Connection failures: exponential backoff retry
- Constraint violations: throw `DatabaseConstraintError`
- Transaction rollback on error

---

### **notion/** - Third-party Template Database
| Service | Responsibility |
|---------|-----------------|
| `NotionClient` | HTTP POST requests to Notion API |
| `NotionService` | Template loading, property mapping, async entry sync |

**Methods**:
```typescript
NotionService:
- syncEntry(entry: KimaiTimeEntry): Promise<void>
- loadTemplates(): Promise<NotionTemplate[]>
- getTemplate(projectId: number): NotionTemplate | null
```

**Dependencies**: `HttpService`, `NotionConfig`, `DatabaseService` (template storage)

**Error Handling**:
- Invalid database ID: log warn, skip entry (non-blocking)
- Missing properties: skip entry gracefully
- Network errors: cache locally, retry in background

---

### **sync/** - Orchestration & Business Logic
| Service | Responsibility |
|---------|-----------------|
| `SyncService` | Coordinate fetch, transform, persist operations |
| `SyncController` | REST endpoints (POST /sync/full, /sync/weekly, GET /sync/status) |

**Methods**:
```typescript
SyncService:
- syncFullHistory(): Promise<SyncResult>
- syncCurrentWeek(): Promise<SyncResult>
- processEntries(entries: KimaiTimeEntry[]): Promise<void>
- getSyncStatus(): Promise<SyncStatus>
```

**Dependencies**: `KimaiService`, `PrismaService`, `NotionService`

**Error Handling**:
- If Kimai fails: throw error (don't proceed to DB)
- If DB fails: throw error (roll back)
- If Notion fails: log and continue (non-critical)

---

### **jobs/** - Asynchronous Job Queue
| Service | Responsibility |
|---------|-----------------|
| `SyncFullJobHandler` | Process full sync jobs from queue |
| `SyncWeeklyJobHandler` | Process weekly sync jobs from queue |
| `ScheduledSyncProvider` | Cron scheduler (5-minute interval) |

**Methods**:
```typescript
@Process('sync-full') handleFullSync(job: Job): Promise<SyncResult>
@Process('sync-weekly') handleWeeklySync(job: Job): Promise<SyncResult>
```

**Dependencies**: `SyncService`, `Queue`, `RedisConfig`

**Error Handling**:
- BullMQ handles retries automatically (3 attempts, exponential backoff)
- Dead-letter queue for failed jobs after max retries
- Log failures with job ID for debugging

---

## 3. Controller Endpoints

### **SyncController** - `/sync` prefix

```typescript
@Controller('sync')
export class SyncController {
  
  @Post('full')
  @HttpCode(202)  // Accepted (job queued)
  async triggerFullSync(): Promise<JobQueuedResponse> {
    // Queue full sync job
    // Returns: { jobId: string, status: 'queued', message: string }
  }

  @Post('weekly')
  @HttpCode(202)
  async triggerWeeklySync(): Promise<JobQueuedResponse> {
    // Queue weekly sync job
    // Returns: { jobId: string, status: 'queued', message: string }
  }

  @Get('status/:jobId')
  @HttpCode(200)
  async getSyncStatus(@Param('jobId') jobId: string): Promise<JobStatusResponse> {
    // Fetch job status from BullMQ
    // Returns: { jobId: string, status: 'queued'|'active'|'completed'|'failed', 
    //           progress: number, result?: SyncResult, error?: string }
  }

  @Get('status')
  @HttpCode(200)
  async getLastSyncStatus(): Promise<SyncStatus> {
    // Get last sync from database
    // Returns: { lastSync: Date, entriesSynced: number, status: 'success'|'failed' }
  }
}
```

### **HealthController** - `/health` prefix

```typescript
@Controller('health')
export class HealthController {
  
  @Get()
  @HealthCheck()
  health() {
    // Check app, DB, Redis, Kimai API, Notion API health
    // Returns: { status: 'up'|'degraded'|'down', checks: { ... } }
  }
}
```

---

## 4. Configuration Structure

### **config/kimai.config.ts**
```typescript
@Injectable()
export class KimaiConfig {
  readonly url: string = process.env.KIMAI_URL || 'http://localhost:8001';
  readonly apiKey: string = process.env.KIMAI_API_KEY || '';
  readonly pageSize: number = parseInt(process.env.KIMAI_PAGE_SIZE || '50', 10);
  readonly timeout: number = parseInt(process.env.KIMAI_TIMEOUT || '30000', 10);
  readonly maxRetries: number = parseInt(process.env.KIMAI_MAX_RETRIES || '3', 10);
  readonly retryDelay: number = parseInt(process.env.KIMAI_RETRY_DELAY || '1000', 10);

  constructor() {
    if (!this.apiKey) throw new Error('KIMAI_API_KEY is required');
  }

  getAuthHeader(): { Authorization: string } {
    return { Authorization: `Bearer ${this.apiKey}` };
  }
}
```

### **config/notion.config.ts**
```typescript
@Injectable()
export class NotionConfig {
  readonly apiKey: string = process.env.NOTION_API_KEY || '';
  readonly version: string = '2022-06-28';
  readonly baseUrl: string = 'https://api.notion.com/v1';
  
  // Template mappings (from config or database)
  private templates: Map<number, NotionTemplate> = new Map();

  constructor() {
    if (!this.apiKey) throw new Error('NOTION_API_KEY is required');
  }

  getAuthHeader(): { Authorization: string } {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  loadTemplates(templates: NotionTemplate[]): void {
    templates.forEach(t => this.templates.set(t.projectId, t));
  }
}
```

### **config/database.config.ts**
```typescript
@Injectable()
export class DatabaseConfig {
  readonly databaseUrl: string = process.env.DATABASE_URL || '';
  readonly sslMode: string = process.env.DATABASE_SSL || 'disable';
  readonly pool: { min: number; max: number } = {
    min: parseInt(process.env.DATABASE_POOL_MIN || '2', 10),
    max: parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
  };

  constructor() {
    if (!this.databaseUrl) throw new Error('DATABASE_URL is required');
  }
}
```

### **config/redis.config.ts**
```typescript
@Injectable()
export class RedisConfig {
  readonly url: string = process.env.REDIS_URL || 'redis://localhost:6379';
  readonly retryStrategy = {
    type: 'exponential' as const,
    delay: 2000, // 2s, 4s, 8s
  };
  readonly jobOptions = {
    attempts: 3,
    backoff: this.retryStrategy,
    removeOnComplete: true,
  };
}
```

### **environment.ts** - Type-safe environment parsing
```typescript
export const Config = {
  kimai: {
    url: process.env.KIMAI_URL || 'http://localhost:8001',
    apiKey: process.env.KIMAI_API_KEY || '',
    pageSize: parseInt(process.env.KIMAI_PAGE_SIZE || '50', 10),
  },
  database: {
    url: process.env.DATABASE_URL || '',
  },
  notion: {
    apiKey: process.env.NOTION_API_KEY || '',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  sync: {
    interval: process.env.SYNC_INTERVAL || '*/5 * * * *',
  },
  app: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
  },
};
```

---

## 5. Type Definitions Structure

### **kimai/kimai.types.ts**
```typescript
export interface KimaiTimeEntry {
  id: number;
  project: { id: number; name: string };
  activity: { id: number; name: string };
  user: { id: number; alias: string };
  description?: string;
  begin: string;      // ISO 8601
  end: string;        // ISO 8601
  duration: number;   // seconds
  billable: boolean;
  exported: boolean;
}

export interface KimaiProject {
  id: number;
  name: string;
  customer: { id: number; name: string };
  visible: boolean;
  archived: boolean;
}

export interface KimaiActivity {
  id: number;
  name: string;
  project?: { id: number };
  visible: boolean;
}

export interface KimaiTimesheetQuery {
  begin?: string;     // ISO 8601
  end?: string;
  user?: string;
  page?: number;
  limit?: number;
}

export interface KimaiApiResponse<T> {
  data: T[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
```

### **sync/sync.types.ts**
```typescript
export interface SyncResult {
  synced: number;           // Count of synced entries
  failed: number;           // Count of failed entries
  skipped: number;          // Count of skipped entries
  duration: number;         // Duration in ms
  timestamp: Date;
  startDate?: Date;
  endDate?: Date;
}

export interface SyncStatus {
  lastSync: Date | null;
  lastSyncStatus: 'success' | 'failed' | 'running' | 'pending';
  lastSyncResult?: SyncResult;
  nextScheduledSync: Date;
  isRunning: boolean;
}

export interface ProcessEntryResult {
  success: boolean;
  entryId: number;
  dbSaved: boolean;
  notionSynced: boolean;
  error?: string;
}

export interface EntryTransform {
  kimaiId: number;
  projectId: number;
  activity: string;
  description: string;
  begin: Date;
  end: Date;
  duration: number;    // seconds
  synced: boolean;
  syncedAt?: Date;
}
```

### **notion/notion.types.ts**
```typescript
export interface NotionTemplate {
  id: string;               // UUID
  projectId: number;        // Kimai project ID
  databaseId: string;       // Notion database ID
  propertyMap: {
    title: string;          // Notion property name for title
    date: string;           // Notion property name for date
    duration: string;       // Notion property name for duration (hours)
    activity?: string;      // Optional: activity field
    description?: string;   // Optional: description field
    project?: string;       // Optional: project name field
  };
  createdAt: Date;
}

export interface NotionPage {
  id: string;
  database_id: string;
  properties: {
    [key: string]: NotionPropertyValue;
  };
  created_time: string;
  last_edited_time: string;
}

export type NotionPropertyValue =
  | { title: Array<{ text: { content: string } }> }
  | { date: { start: string; end?: string } }
  | { number: number }
  | { rich_text: Array<{ text: { content: string } }> };
```

### **jobs/jobs.types.ts**
```typescript
export interface SyncJobPayload {
  userId?: string;
  metadata?: Record<string, any>;
}

export interface JobQueuedResponse {
  jobId: string | number;
  status: 'queued';
  message: string;
}

export interface JobStatusResponse {
  jobId: string | number;
  status: 'queued' | 'active' | 'completed' | 'failed' | 'delayed';
  progress?: number;
  result?: SyncResult;
  error?: {
    message: string;
    name: string;
    stack?: string;
  };
}
```

---

## 6. Dependency Injection Map

```
┌─────────────────────────────────────────────────────────────┐
│                   Root: app.module.ts                       │
└────┬────────────────────────────────────────────────────────┘
     │
     ├──> config.module.ts
     │    ├─ KimaiConfig (singleton)
     │    ├─ NotionConfig (singleton)
     │    ├─ DatabaseConfig (singleton)
     │    └─ RedisConfig (singleton)
     │
     ├──> database.module.ts
     │    ├─ Depends on: DatabaseConfig
     │    ├─ PrismaService (singleton - lifecycle hooks)
     │    └─ Exports: PrismaService
     │
     ├──> kimai.module.ts
     │    ├─ Depends on: KimaiConfig, HttpService
     │    ├─ KimaiClient (private)
     │    ├─ KimaiService
     │    └─ Exports: KimaiService
     │
     ├──> notion.module.ts
     │    ├─ Depends on: NotionConfig, HttpService, DatabaseService
     │    ├─ NotionClient (private)
     │    ├─ NotionService
     │    └─ Exports: NotionService
     │
     ├──> sync.module.ts
     │    ├─ Depends on: KimaiService, PrismaService, NotionService
     │    ├─ SyncService
     │    ├─ SyncController
     │    └─ Exports: SyncService
     │
     └──> jobs.module.ts
          ├─ Depends on: SyncService, RedisConfig, BullModule
          ├─ SyncFullJobHandler
          ├─ SyncWeeklyJobHandler
          ├─ ScheduledSyncProvider
          ├─ SyncController
          └─ Exports: none (internal)
```

## 7. Data Flow Diagram

### Full Sync Flow (On-Demand)
```
┌──────────────────────────────────────────────────────────────┐
│ USER: POST /sync/full                                        │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │  SyncController      │
        │  triggerFullSync()   │ ─────────────────────────┐
        └──────────────────────┘                         │
                   │                                    │
                   ▼                                    │
        ┌──────────────────────┐                      │
        │   BullMQ Queue       │                      │
        │  sync-full (queued)  │                      │
        └──────────────────────┘                      │
                   │                                   │
                   ▼                                   │
        ┌────────────────────────────┐              │
        │ SyncFullJobHandler         │              │
        │ @Process('sync-full')      │ ◄───────────┘
        │ handleFullSync()           │
        └────────────┬───────────────┘
                     │
              ┌──────┴──────┐
              │             │
              ▼             ▼
    ┌──────────────────┐  ┌──────────────────┐
    │  SyncService     │  │  KimaiService    │
    │  syncFullHistory │  │ getTimeEntries   │
    │  (3 years data)  │  │ (last 3 years)   │
    └────────┬─────────┘  └──────────────────┘
             │
             ├─ For each entry:
             │  ├─────────────────────────────┐
             │  │    1. Upsert to DB (Prisma) │
             │  │       (synchronous)         │
             │  │                             │
             │  │    2. Notify Notion (async) │
             │  │       fire-and-forget       │
             │  └─────────────────────────────┘
             │
             ▼
    ┌──────────────────────────────┐
    │  Job completed               │
    │  Return SyncResult           │
    │  Status: 202 Accepted        │
    └──────────────────────────────┘
```

### Scheduled Sync Flow (Every 5 Minutes)
```
┌───────────────────────────────────────┐
│  Cron Trigger (node-cron)            │
│  */5 * * * * (every 5 minutes)       │
└────────────────┬──────────────────────┘
                 │
                 ▼
┌───────────────────────────────────────┐
│ ScheduledSyncProvider                │
│ onModuleInit() - sets up cron        │
└────────────────┬──────────────────────┘
                 │
                 ▼
┌───────────────────────────────────────┐
│ Add job to BullMQ queue              │
│ Queue: 'sync-jobs'                   │
│ Type: 'sync-weekly'                  │
└────────────────┬──────────────────────┘
                 │
    ┌────────────┴────────────┐
    │ If no job running       │ 
    │ Process immediately     │
    │                        │
    ▼                        ▼
ProcessQueue         Wait for slot
    │                │
    └────────┬───────┘
             │
             ▼
┌──────────────────────────────┐
│ SyncWeeklyJobHandler         │
│ handleWeeklySync()           │
│ (current week entries)       │
└──────────┬───────────────────┘
           │
           ├─ Save to PostgreSQL
           ├─ Sync to Notion (async)
           │
           ▼
        Wait 5 minutes → Next cycle
```

### Data Persistence Path
```
Kimai API
    ↓
KimaiService.getTimeEntries() - Fetch with pagination & retry
    ↓
SyncService.processEntries() - Transform data
    │
    ├─ [CRITICAL] PrismaService.timeEntry.upsert() ◄─── Idempotent
    │                 └─> PostgreSQL (PRIMARY STORE)
    │
    └─ [NON-BLOCKING] NotionService.syncEntry() (async)
                           ├─ Get template for project
                           ├─ Map properties
                           └─> Notion API (SECONDARY STORE)
```

---

## 8. Error Handling Strategy Per Module

### **kimai/** - External API Errors
```typescript
// Strategy: Fail fast, retry on transient errors only

export class KimaiService {
  private logger = new Logger(KimaiService.name);

  async getTimeEntries(start: Date, end: Date): Promise<KimaiTimeEntry[]> {
    return withRetry(
      async () => {
        try {
          return await this.client.get('/timesheets', {
            params: { begin: start.toISOString(), end: end.toISOString() },
          });
        } catch (error) {
          if (error.status === 401 || error.status === 403) {
            throw new KimaiAuthenticationError('Invalid Kimai credentials');
          }
          if (error.status === 404) {
            throw new KimaiNotFoundError('Kimai endpoint not found');
          }
          if (error.code === 'ECONNREFUSED') {
            throw new KimaiConnectionError('Kimai server unreachable');
          }
          throw error; // Retry on network errors
        }
      },
      3, // maxRetries
      1000 // delay
    );
  }
}

// Custom exception class
export class KimaiAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KimaiAuthenticationError';
  }
}
```

**Error Handling Approach**:
- **Network errors** (timeout, ECONNREFUSED): Retry with exponential backoff
- **Auth errors** (401, 403): Throw immediately, don't retry
- **Not found** (404): Throw immediately
- **Rate limiting** (429): Retry with longer delay

---

### **database/** - Persistence Errors
```typescript
// Strategy: Transaction rollback, constraint validation

export class PrismaService extends PrismaClient {
  async upsertTimeEntry(entry: EntryTransform) {
    try {
      return await this.$transaction(async (tx) => {
        // 1. Ensure project exists
        const project = await tx.project.findUnique({
          where: { kimaiId: entry.projectId },
        });

        if (!project) {
          throw new DatabaseConstraintError(
            `Project ${entry.projectId} not found in DB`
          );
        }

        // 2. Upsert entry (atomic operation)
        return await tx.timeEntry.upsert({
          where: { kimaiId: entry.kimaiId },
          update: {
            duration: entry.duration,
            description: entry.description,
            updatedAt: new Date(),
          },
          create: {
            kimaiId: entry.kimaiId,
            projectId: project.id,
            activity: entry.activity,
            description: entry.description,
            begin: entry.begin,
            end: entry.end,
            duration: entry.duration,
          },
        });
      });
    } catch (error) {
      if (error.code === 'P2002') {
        // Unique constraint violation
        this.logger.warn(`Duplicate entry: ${error.meta?.target}`);
        throw new DatabaseConstraintError('Duplicate entry', error);
      }
      if (error.code === 'P2025') {
        // Record not found
        throw new DatabaseNotFoundError('Record not found', error);
      }
      throw new DatabaseError('Database operation failed', error);
    }
  }
}

export class DatabaseConstraintError extends Error {
  constructor(message: string, originalError?: any) {
    super(message);
    this.name = 'DatabaseConstraintError';
    this.cause = originalError;
  }
}
```

**Error Handling Approach**:
- **Constraint violations**: Log, throw (should not happen with valid data)
- **Connection failures**: Retry with PrismaClient internal logic
- **Transaction rollback**: Automatic on error
- **Duplicate entries**: Idempotent (upsert handles this)

---

### **sync/** - Orchestration Errors
```typescript
// Strategy: Partial success (DB yes, Notion no), clear logging

export class SyncService {
  private logger = new Logger(SyncService.name);

  async syncFullHistory(): Promise<SyncResult> {
    const startTime = Date.now();
    let synced = 0, failed = 0, skipped = 0;

    try {
      // 1. Fetch from Kimai (critical - if this fails, abort)
      const entries = await this.kimai.getTimeEntries(start, end);
      this.logger.log(`Fetched ${entries.length} entries from Kimai`);

      // 2. Process each entry
      for (const entry of entries) {
        try {
          await this.processEntry(entry);
          synced++;
        } catch (error) {
          if (error instanceof DatabaseConstraintError) {
            failed++;
            this.logger.error(`Failed to save entry ${entry.id}: ${error.message}`);
          } else {
            skipped++;
            this.logger.warn(`Skipped entry ${entry.id}: ${error.message}`);
          }
        }
      }

      this.logger.log(
        `Sync complete: ${synced} succeeded, ${failed} failed, ${skipped} skipped`
      );

      return {
        synced,
        failed,
        skipped,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      // Critical error - abort entire sync
      this.logger.error(`Sync aborted: ${error.message}`);
      throw new SyncError('Full sync aborted', error);
    }
  }

  private async processEntry(entry: KimaiTimeEntry): Promise<void> {
    // 1. Save to DB (critical)
    const transform = this.transformEntry(entry);
    await this.prisma.upsertTimeEntry(transform);

    // 2. Sync to Notion (non-critical)
    try {
      await this.notion.syncEntry(entry);
    } catch (error) {
      // Log but don't throw (Notion is secondary)
      this.logger.warn(`Notion sync failed for entry ${entry.id}: ${error.message}`);
    }
  }
}

export class SyncError extends Error {
  constructor(message: string, originalError?: any) {
    super(message);
    this.name = 'SyncError';
    this.cause = originalError;
  }
}
```

**Error Handling Approach**:
- **Kimai fetch fails**: Throw immediately (abort entire sync)
- **DB save fails**: Count as failed, log, continue with next entry
- **Notion sync fails**: Log and continue (non-critical)
- **Partial success is OK**: Return result with counts

---

### **notion/** - Template Sync Errors
```typescript
// Strategy: Graceful degradation (skip missing templates, log warnings)

export class NotionService {
  private logger = new Logger(NotionService.name);
  private templates: Map<number, NotionTemplate> = new Map();

  async syncEntry(entry: KimaiTimeEntry): Promise<void> {
    const template = this.templates.get(entry.project.id);

    if (!template) {
      // Missing template - non-critical
      this.logger.warn(
        `No Notion template for project ${entry.project.id} (${entry.project.name}). Skipping.`
      );
      return;
    }

    try {
      const payload = this.buildPagePayload(entry, template);
      await this.client.createPage(payload);
    } catch (error) {
      if (error.status === 404) {
        // Database no longer exists
        this.logger.error(`Notion database ${template.databaseId} not found. Skipping.`);
        return;
      }
      if (error.status === 429) {
        // Rate limited (retry in background)
        this.logger.warn(`Notion rate limited. Entry ${entry.id} will retry.`);
        throw new NotionRateLimitError('Rate limited', error);
      }
      if (error.status === 401 || error.status === 403) {
        // Auth failed
        this.logger.error(`Notion authentication failed: ${error.message}`);
        throw new NotionAuthenticationError('Auth failed', error);
      }
      // Other errors (network, etc)
      throw new NotionSyncError(`Failed to sync entry ${entry.id}`, error);
    }
  }

  private buildPagePayload(
    entry: KimaiTimeEntry,
    template: NotionTemplate
  ): NotionPagePayload {
    return {
      parent: { database_id: template.databaseId },
      properties: {
        [template.propertyMap.title]: {
          title: [
            { text: { content: entry.description || entry.activity.name } },
          ],
        },
        [template.propertyMap.date]: {
          date: { start: entry.begin },
        },
        [template.propertyMap.duration]: {
          number: Math.round(entry.duration / 3600), // Convert to hours
        },
        ...(template.propertyMap.activity && {
          [template.propertyMap.activity]: {
            rich_text: [{ text: { content: entry.activity.name } }],
          },
        }),
      },
    };
  }
}

export class NotionRateLimitError extends Error {
  constructor(message: string, originalError?: any) {
    super(message);
    this.name = 'NotionRateLimitError';
    this.cause = originalError;
  }
}
```

**Error Handling Approach**:
- **Missing template**: Log warning, skip entry (graceful)
- **Auth error**: Throw, stop syncing (requires manual fix)
- **Rate limit**: Throw, BullMQ retries automatically
- **Network error**: Throw, BullMQ retries automatically
- **404 database**: Log error, skip entry (template misconfigured)

---

### **jobs/** - Queue Processing Errors
```typescript
// Strategy: BullMQ handles retries automatically

@Processor('sync-jobs')
export class SyncFullJobHandler {
  private logger = new Logger(SyncFullJobHandler.name);

  @Process('sync-full')
  async handleFullSync(job: Job<SyncJobPayload>) {
    // BullMQ will:
    // 1. Retry on exception (3 attempts, exponential backoff: 2s, 4s, 8s)
    // 2. Move to failed queue if all retries exhausted
    // 3. Log job history

    try {
      this.logger.log(`[Job ${job.id}] Starting full sync...`);

      const result = await this.sync.syncFullHistory();

      this.logger.log(`[Job ${job.id}] Completed: ${JSON.stringify(result)}`);

      return result;
    } catch (error) {
      this.logger.error(
        `[Job ${job.id}] Error (attempt ${job.attemptsMade + 1}/3): ${error.message}`
      );

      // Check if we should retry
      if (error instanceof KimaiAuthenticationError) {
        // Don't retry auth errors, move to failed immediately
        throw new Error('Auth failed - no retry');
      }

      // Throw to trigger BullMQ retry
      throw error;
    }
  }
}

// Configure retry strategy in jobs.module.ts
BullModule.registerQueue({
  name: 'sync-jobs',
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000, // 2s, 4s, 8s
    },
    removeOnComplete: true,
    removeOnFail: false, // Keep failed jobs for debugging
  },
})
```

**Error Handling Approach**:
- **Network/transient errors**: Auto-retry with exponential backoff
- **Auth errors**: Fail immediately (no retry)
- **Validation errors**: Fail immediately
- **Failed job**: Stored in queue for manual inspection

---

## 9. Step-by-Step Implementation Sequence

### Phase 1: Foundation (Days 1-2)

**Goal**: Set up project structure, configuration, and database.

```
Step 1: Initialize NestJS project
  ├─ npm install
  ├─ Configure tsconfig.json
  └─ Setup .env.example and environment parsing

Step 2: Create config module (config/)
  ├─ KimaiConfig
  ├─ NotionConfig
  ├─ DatabaseConfig
  ├─ RedisConfig
  └─ config.module.ts

Step 3: Create database module (database/)
  ├─ Prisma setup (npm install @prisma/client prisma)
  ├─ schema.prisma (Project, TimeEntry models)
  ├─ PrismaService
  ├─ database.module.ts
  └─ Initial migration

Step 4: Create type definitions
  ├─ kimai/kimai.types.ts
  ├─ sync/sync.types.ts
  ├─ notion/notion.types.ts
  └─ jobs/jobs.types.ts

Validation:
  □ npm run build succeeds
  □ npx prisma migrate dev succeeds
  □ All config services load without errors
```

---

### Phase 2: External API Clients (Days 2-3)

**Goal**: Create Kimai and Notion API clients with retry logic.

```
Step 5: Create Kimai module (kimai/)
  ├─ KimaiClient (HTTP wrapper with headers)
  ├─ KimaiService with withRetry() helper
  │  ├─ getTimeEntries(start, end)
  │  ├─ getRecentEntries(days)
  │  └─ getProjects()
  ├─ Error classes (KimaiAuthenticationError, etc.)
  └─ kimai.module.ts

Step 6: Create Notion module (notion/)
  ├─ NotionClient (HTTP wrapper)
  ├─ NotionService
  │  ├─ loadTemplates()
  │  ├─ getTemplate(projectId)
  │  └─ syncEntry(entry)
  ├─ Error classes
  └─ notion.module.ts

Step 7: Add common utilities
  ├─ common/utils/retry.helper.ts
  ├─ common/utils/date.helper.ts
  ├─ common/exceptions/ (all custom exceptions)
  └─ common/filters/ (global exception handler)

Validation:
  □ npm run test succeeds for kimai.service.spec.ts
  □ npm run test succeeds for notion.service.spec.ts
  □ Retry logic works correctly
  □ API errors map to custom exceptions
```

---

### Phase 3: Core Sync Logic (Days 3-4)

**Goal**: Implement sync orchestration and coordination.

```
Step 8: Create sync module (sync/)
  ├─ SyncService
  │  ├─ syncFullHistory()
  │  │  └─ Fetch last 3 years from Kimai
  │  ├─ syncCurrentWeek()
  │  │  └─ Fetch current week
  │  ├─ processEntries(entries)
  │  │  ├─ Transform entry
  │  │  ├─ Upsert to DB
  │  │  └─ Sync to Notion (async)
  │  └─ getSyncStatus()
  ├─ SyncController
  │  ├─ POST /sync/full
  │  ├─ POST /sync/weekly
  │  └─ GET /sync/status
  └─ sync.module.ts

Step 9: Add error handling
  ├─ Handle Kimai fetch failure (abort)
  ├─ Handle DB save failure (count as failed)
  ├─ Handle Notion fail (log, continue)
  └─ Detailed logging with context

Step 10: Create database helper queries
  ├─ findOrCreateProject(kimaiId)
  ├─ getSyncStatus()
  └─ Query recent syncs

Validation:
  □ Manual test: POST /sync/weekly
  □ Verify DB saved entries
  □ Check logs for all operations
  □ GET /sync/status returns correct data
  □ Test error scenarios (Kimai down, DB error, etc.)
```

---

### Phase 4: Job Queue & Scheduling (Days 4-5)

**Goal**: Set up BullMQ and cron scheduler.

```
Step 11: Configure Redis and BullMQ
  ├─ npm install @nestjs/bull bull
  ├─ Redis config in RedisConfig
  ├─ Update app.module.ts with BullModule
  └─ Register 'sync-jobs' queue

Step 12: Create job handlers (jobs/)
  ├─ SyncFullJobHandler
  │  ├─ @Process('sync-full')
  │  └─ handleFullSync()
  ├─ SyncWeeklyJobHandler
  │  ├─ @Process('sync-weekly')
  │  └─ handleWeeklySync()
  └─ Configure job retry options

Step 13: Create scheduled sync provider
  ├─ ScheduledSyncProvider
  ├─ cron.schedule() setup (*/5 * * * *)
  ├─ Ensure no duplicate parallel jobs
  └─ Configurable interval via env var

Step 14: Update SyncController to use queue
  ├─ POST /sync/full → Queue job, return jobId
  ├─ POST /sync/weekly → Queue job, return jobId
  └─ GET /sync/status/:jobId → Check job status

Validation:
  □ Redis connection works (redis-cli ping)
  □ POST /sync/full returns jobId
  □ Job executes and completes
  □ GET /sync/status/:jobId shows progress
  □ Cron triggers every 5 minutes
  □ Retry on failure works (3 attempts)
  □ Scheduled job doesn't overlap (job lock)
```

---

### Phase 5: Health & Monitoring (Days 5-6)

**Goal**: Add health checks and observability.

```
Step 15: Create health endpoints
  ├─ GET /health → Overall status
  ├─ Check app status ✓
  ├─ Check PostgreSQL connection
  ├─ Check Redis connection
  ├─ Check Kimai API reachability
  └─ Check Notion API reachability

Step 16: Add logging & monitoring
  ├─ NestJS Logger integration
  ├─ Structured logging (JSON)
  ├─ Log all API calls (request/response)
  ├─ Log all DB operations
  └─ Log job queue events

Step 17: Error tracking
  ├─ Centralized exception filter
  ├─ Map all errors to HTTP status codes
  ├─ Return consistent error responses
  └─ Log stack traces for debugging

Validation:
  □ GET /health returns 200 with all checks ✓
  □ Logs are structured and queryable
  □ All errors are logged with context
  □ No sensitive data in logs (API keys redacted)
```

---

### Phase 6: Testing & Documentation (Days 6-7)

**Goal**: Complete unit tests and documentation.

```
Step 18: Write test suites
  ├─ kimai.service.spec.ts
  │  ├─ Test getTimeEntries() success
  │  ├─ Test retry on network error
  │  ├─ Test auth error handling
  │  └─ Test pagination
  ├─ sync.service.spec.ts
  │  ├─ Test syncFullHistory()
  │  ├─ Test processEntries()
  │  ├─ Test DB save + Notion async
  │  └─ Test partial failures
  └─ Test coverage > 80%

Step 19: Integration tests
  ├─ Test full flow: Kimai → DB → Notion
  ├─ Test with Docker containers
  ├─ Test retry behavior
  └─ Test error recovery

Step 20: Documentation
  ├─ API documentation (Swagger/OpenAPI)
  ├─ Setup & configuration guide
  ├─ Troubleshooting guide
  ├─ Deployment guide
  └─ Architecture decision records (ADRs)

Validation:
  □ Test coverage >= 80%
  □ All tests pass
  □ Swagger docs available at /api/docs
  □ README.md complete
  □ Deployment ready
```

---

### Phase 7: Production Deployment (Days 7+)

**Goal**: Containerize and deploy.

```
Step 21: Containerization
  ├─ Create Dockerfile (multi-stage build)
  ├─ Create docker-compose.yml
  │  ├─ NestJS app container
  │  ├─ PostgreSQL container
  │  └─ Redis container
  └─ Test local Docker build

Step 22: Environment management
  ├─ .env.development (local)
  ├─ .env.production (real servers)
  ├─ .env.test (test environment)
  └─ Verify all required vars set

Step 23: Deployment
  ├─ Push to registry (Docker Hub, ECR, etc.)
  ├─ Deploy to Kubernetes/Docker Swarm/VM
  ├─ Set up log aggregation (ELK, CloudWatch)
  ├─ Monitor with Prometheus/Grafana
  └─ Set up alerts for failures

Step 24: Production validation
  ├─ GET /health returns 200
  ├─ Kimai sync completes without errors
  ├─ Data appears in PostgreSQL
  ├─ Data appears in Notion
  └─ Scheduled jobs run every 5 minutes

Validation:
  □ Docker container builds successfully
  □ All services start in docker-compose
  □ Full sync completes end-to-end
  □ Logs are centralized and searchable
  □ Alerts trigger on failures
```

---

## Implementation Checklist

### Pre-Implementation
- [x] Review kimai-sync.instructions.md
- [x] Understand module responsibilities
- [x] Plan dependency injection
- [x] Design database schema

### Phase 1 - Foundation
- [ ] Initialize NestJS project
- [ ] Setup configuration services
- [ ] Create Prisma schema and migration
- [ ] Create type definitions

### Phase 2 - API Clients
- [ ] Implement Kimai client with retry logic
- [ ] Implement Notion client
- [ ] Add custom exceptions
- [ ] Add utility helpers

### Phase 3 - Sync Logic
- [ ] Implement SyncService
- [ ] Create SyncController with endpoints
- [ ] Add database helper queries
- [ ] Test error scenarios

### Phase 4 - Jobs & Scheduling
- [ ] Configure BullMQ with Redis
- [ ] Create job handlers
- [ ] Implement cron scheduler
- [ ] Add job status endpoints

### Phase 5 - Health & Monitoring
- [ ] Create health endpoint
- [ ] Implement structured logging
- [ ] Add exception filter
- [ ] Test error handling

### Phase 6 - Testing
- [ ] Write unit tests (>80% coverage)
- [ ] Write integration tests
- [ ] Create API documentation
- [ ] Write deployment guide

### Phase 7 - Deployment
- [ ] Create Dockerfile
- [ ] Create docker-compose.yml
- [ ] Deploy to production
- [ ] Setup monitoring and alerts

---

## Dependency Graph (No Circular Dependencies)

```
config/
  └─ All configs are leaf nodes (no dependencies)

kimai/ → config/
  └─ Imports: KimaiConfig

notion/ → config/
  └─ Imports: NotionConfig

database/ → config/
  └─ Imports: DatabaseConfig

sync/ → kimai/, database/, notion/
  └─ Imports: KimaiService, PrismaService, NotionService

jobs/ → sync/, config/
  └─ Imports: SyncService, RedisConfig

app.module.ts → all modules
  └─ Orchestrates all modules

Hierarchy:
  config/ (no deps)
    ↑
    └─ kimai/, notion/, database/ (1-level deep)
       ↑
       └─ sync/ (2-level deep)
          ↑
          └─ jobs/ (3-level deep)
          └─ app.module.ts (root)

✓ NO CIRCULAR DEPENDENCIES
✓ CLEAR DEPENDENCY FLOW
✓ TESTABLE (mock dependencies)
```

---

## Success Criteria

By the end of implementation, you should have:

1. ✅ **Module Structure**: 5 core modules (kimai, database, sync, jobs, notion) + config, common
2. ✅ **Clear Responsibilities**: Each service does one thing
3. ✅ **Working Endpoints**:
   - POST /sync/full → Queue full sync
   - POST /sync/weekly → Queue weekly sync
   - GET /sync/status → Get last sync status
   - GET /health → Health check
4. ✅ **Database**: PostgreSQL with Prisma, upsert-based sync
5. ✅ **Job Queue**: BullMQ with 3 retry attempts, exponential backoff
6. ✅ **Scheduling**: Cron every 5 minutes, non-blocking
7. ✅ **Error Handling**: Specific exceptions per module, graceful degradation
8. ✅ **Type Safety**: Comprehensive TypeScript interfaces
9. ✅ **Dependencies**: No circular dependencies, clean injection
10. ✅ **Testing**: >80% unit test coverage, integration tests
11. ✅ **Logging**: Structured logs with context
12. ✅ **Documentation**: API docs, setup guide, architecture decision records

---

## Architecture Validation Checklist

### Against kimai-sync.instructions.md Guidelines

- [x] **Modules**: Organized by domain (kimai, sync, jobs, notion, database)
- [x] **One Responsibility**: Each service has single responsibility
- [x] **Dependency Injection**: NestJS constructor injection, no global state
- [x] **Configuration**: Separate config services, environment-driven
- [x] **Error Handling**: Try/catch with custom exceptions, retry logic
- [x] **Logging**: NestJS Logger with context names
- [x] **Code Style**: Explicit naming, max 20 lines per function, comments explain "why"
- [x] **Type Safety**: All parameters and returns typed
- [x] **Sync Modes**: On-demand (full 3 years) + scheduled (weekly, every 5 min)
- [x] **Idempotent Operations**: Prisma upsert, safe for retries
- [x] **Data Flow**: Kimai → Sync → DB → Notion
- [x] **No Circular Dependencies**: Clear hierarchy
- [x] **Testing Pattern**: Mocked dependencies, clear test structure
- [x] **Database Schema**: Projects, TimeEntries with idempotent keys
- [x] **Job Queue**: BullMQ with automatic retry/backoff
- [x] **Scheduled Sync**: node-cron, non-blocking, configurable interval
