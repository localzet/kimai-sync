---
description: "Use when building the Kimai sync application. Covers NestJS modules, Prisma patterns, BullMQ job architecture, scheduled sync design, and API integration with Kimai, PostgreSQL, and Notion."
applyTo: "src/**"
---

# Kimai Sync - Architecture & Code Guidelines

## Project Overview

**Goal**: Synchronize time tracking data from Kimai to PostgreSQL and Notion with project-specific templates.

**Sync Modes**:
1. **On-demand**: Full sync of last 3 years of Kimai data
2. **Scheduled**: Every 5 minutes, sync current week data

**Tech Stack**: NestJS, Prisma, BullMQ (job queue), node-cron (scheduling), Docker

---

## Architecture Principles

### Module Organization

Keep code **simple and readable**. Organize by domain concerns:

```
src/
├── modules/
│   ├── kimai/              # Kimai API client
│   │   ├── kimai.service.ts
│   │   ├── kimai.client.ts
│   │   └── kimai.module.ts
│   ├── sync/               # Core sync logic
│   │   ├── sync.service.ts
│   │   ├── sync.controller.ts
│   │   └── sync.module.ts
│   ├── jobs/               # BullMQ job handlers
│   │   ├── sync-full.job.ts
│   │   ├── sync-weekly.job.ts
│   │   └── jobs.module.ts
│   ├── notion/             # Notion API integration
│   │   ├── notion.service.ts
│   │   ├── notion.client.ts
│   │   └── notion.module.ts
│   └── database/           # Prisma & queries
│       ├── prisma.service.ts
│       └── database.module.ts
├── config/
│   ├── kimai.config.ts
│   ├── notion.config.ts
│   └── database.config.ts
├── types/                  # TypeScript interfaces
│   ├── kimai.types.ts
│   ├── sync.types.ts
│   └── notion.types.ts
└── app.module.ts
```

**Principle**: Each module has **one responsibility**. Pass dependencies via NestJS injection.

---

## Core Modules

### 1. **Kimai Module** - API Client

**Responsibility**: Fetch time entries from Kimai API.

```typescript
// kimai.service.ts
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';

export interface KimaiTimeEntry {
  id: number;
  project: { id: number; name: string };
  activity: { name: string };
  description: string;
  begin: string; // ISO 8601
  end: string;   // ISO 8601
  duration: number; // seconds
}

@Injectable()
export class KimaiService {
  constructor(private http: HttpService) {}

  // Fetch time entries for a date range
  async getTimeEntries(start: Date, end: Date): Promise<KimaiTimeEntry[]> {
    // Implementation: query Kimai API with pagination
  }

  // Fetch recent entries (current week)
  async getRecentEntries(days: number = 7): Promise<KimaiTimeEntry[]> {
    // Implementation
  }
}
```

**Key Points**:
- Handle pagination (Kimai returns limited results per request)
- Use environment variables for API key (`KIMAI_URL`, `KIMAI_API_KEY`)
- Retry failed requests (transient failures are common)

---

### 2. **Sync Module** - Orchestration

**Responsibility**: Coordinate data fetch, transform, and write.

```typescript
// sync.service.ts
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SyncService {
  private logger = new Logger(SyncService.name);

  constructor(
    private kimai: KimaiService,
    private prisma: PrismaService,
    private notion: NotionService,
  ) {}

  // Full sync: last 3 years
  async syncFullHistory(): Promise<SyncResult> {
    this.logger.log('Starting full history sync...');
    
    const start = new Date();
    start.setFullYear(start.getFullYear() - 3);
    const end = new Date();

    const entries = await this.kimai.getTimeEntries(start, end);
    await this.processEntries(entries);
    
    return { synced: entries.length, timestamp: new Date() };
  }

  // Weekly sync: current week
  async syncCurrentWeek(): Promise<SyncResult> {
    const today = new Date();
    const start = this.getMonday(today);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);

    const entries = await this.kimai.getRecentEntries();
    await this.processEntries(entries);
    
    return { synced: entries.length, timestamp: new Date() };
  }

  // Transform and save to DB + Notion
  private async processEntries(entries: KimaiTimeEntry[]): Promise<void> {
    for (const entry of entries) {
      // 1. Save to PostgreSQL
      await this.prisma.timeEntry.upsert({
        where: { kimaiId: entry.id },
        update: { /* updated fields */ },
        create: { /* new entry */ },
      });

      // 2. Sync to Notion (async, non-blocking)
      this.notion.syncEntry(entry).catch(err => 
        this.logger.error(`Failed to sync to Notion: ${err.message}`)
      );
    }
  }

  private getMonday(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  }
}
```

**Key Points**:
- Use `upsert` for idempotent updates (safe to re-run)
- Notion sync is **fire-and-forget** (non-blocking)
- Log all sync operations with timestamps

---

### 3. **Jobs Module** - BullMQ Queues

**Responsibility**: Manage job queues for both sync modes.

```typescript
// sync-full.job.ts
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { SyncService } from '../sync/sync.service';

@Processor('sync-jobs')
export class SyncFullJobHandler {
  constructor(private sync: SyncService) {}

  @Process('sync-full')
  async handleFullSync(job: Job<{ userId?: string }>) {
    console.log('🔄 Full sync started...');
    
    try {
      const result = await this.sync.syncFullHistory();
      return { success: true, ...result };
    } catch (error) {
      console.error('❌ Sync failed:', error);
      throw error; // BullMQ will retry
    }
  }
}

// sync-weekly.job.ts
@Processor('sync-jobs')
export class SyncWeeklyJobHandler {
  constructor(private sync: SyncService) {}

  @Process('sync-weekly')
  async handleWeeklySync(job: Job) {
    console.log('📅 Weekly sync started...');
    
    const result = await this.sync.syncCurrentWeek();
    return { success: true, ...result };
  }
}
```

**Controller** (expose on-demand sync):

```typescript
// sync.controller.ts
import { Controller, Post } from '@nestjs/common';
import { Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';

@Controller('sync')
export class SyncController {
  constructor(@InjectQueue('sync-jobs') private syncQueue: Queue) {}

  @Post('full')
  async triggerFullSync() {
    const job = await this.syncQueue.add('sync-full', {}, {
      removeOnComplete: true,
    });
    return { jobId: job.id, status: 'queued' };
  }

  @Post('weekly')
  async triggerWeeklySync() {
    const job = await this.syncQueue.add('sync-weekly', {}, {
      removeOnComplete: true,
    });
    return { jobId: job.id, status: 'queued' };
  }
}
```

**Key Points**:
- Each sync mode is a separate job type (`sync-full`, `sync-weekly`)
- BullMQ auto-retries on failure
- Use `removeOnComplete: true` to clean up finished jobs
- Expose REST endpoints for on-demand triggers

---

### 4. **Scheduled Sync** - Every 5 Minutes

Use `node-cron` in an NestJS provider:

```typescript
// scheduled-sync.provider.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import * as cron from 'node-cron';
import { Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';

@Injectable()
export class ScheduledSyncProvider implements OnModuleInit {
  constructor(@InjectQueue('sync-jobs') private syncQueue: Queue) {}

  onModuleInit() {
    // Every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      console.log('⏰ Triggering scheduled weekly sync...');
      
      await this.syncQueue.add('sync-weekly', {}, {
        removeOnComplete: true,
      });
    });

    console.log('✅ Cron scheduler initialized (every 5 minutes)');
  }
}
```

Add to `jobs.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduledSyncProvider } from './scheduled-sync.provider';

@Module({
  imports: [BullModule.registerQueue({ name: 'sync-jobs' })],
  providers: [ScheduledSyncProvider, SyncFullJobHandler, SyncWeeklyJobHandler],
  controllers: [SyncController],
})
export class JobsModule {}
```

**Key Points**:
- Cron runs in the application, not as an external service
- Schedule is configurable via `process.env.SYNC_INTERVAL`
- Job queue prevents duplicate runs if one is still processing

---

### 5. **Notion Module** - Template & Database

**Responsibility**: Sync time entries to Notion with project-specific templates.

```typescript
// notion.service.ts
import { Injectable, Logger } from '@nestjs/common';

interface NotionTemplate {
  databaseId: string;
  projectId: number;
  propertyMap: {
    title: string;       // Which property holds the title
    date: string;        // Date property name
    duration: string;    // Duration property name
  };
}

@Injectable()
export class NotionService {
  private logger = new Logger(NotionService.name);
  private templates: Map<number, NotionTemplate> = new Map();

  constructor(private http: HttpService) {
    this.loadTemplates();
  }

  private loadTemplates() {
    // Load from config or database
    // Map: projectId → Notion database template
  }

  async syncEntry(entry: KimaiTimeEntry): Promise<void> {
    const template = this.templates.get(entry.project.id);
    if (!template) {
      this.logger.warn(`No Notion template for project ${entry.project.id}`);
      return;
    }

    const payload = {
      parent: { database_id: template.databaseId },
      properties: {
        [template.propertyMap.title]: {
          title: [{ text: { content: entry.description || entry.activity.name } }],
        },
        [template.propertyMap.date]: {
          date: { start: entry.begin },
        },
        [template.propertyMap.duration]: {
          number: Math.round(entry.duration / 3600), // Convert to hours
        },
      },
    };

    await this.http.post('https://api.notion.com/v1/pages', payload).toPromise();
  }
}
```

**Key Points**:
- Store Notion database IDs and property mappings in config
- One template per project (flexible structure)
- Handle missing templates gracefully (log, don't crash)

---

## Data Flow Diagram

```
┌─────────────────────┐
│   Kimai API         │
└──────────┬──────────┘
           │
           ▼
┌────────────────────┐        ┌──────────────────────┐
│  Kimai Service     │───────▶│  Sync Service        │
│  - getTimeEntries  │        │  - Process entries   │
│  - retry logic     │        │  - Transform data    │
└────────────────────┘        └──────┬───────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
              ┌────────────┐    ┌────────────┐   ┌──────────┐
              │PostgreSQL  │    │  Notion    │   │ BullMQ   │
              │(Prisma ORM)│    │  (async)   │   │(scheduler)
              └────────────┘    └────────────┘   └──────────┘

Schedule: Every 5 min → BullMQ → Sync Service → Kimai/DB/Notion
Manual:   POST /sync/full → BullMQ → Sync Service → Last 3 years
```

---

## Database Schema (Prisma)

```prisma
// prisma/schema.prisma
model Project {
  id        Int     @id @default(autoincrement())
  kimaiId   Int     @unique
  name      String
  entries   TimeEntry[]
  notionDatabaseId String?
  createdAt DateTime @default(now())
}

model TimeEntry {
  id        Int     @id @default(autoincrement())
  kimaiId   Int     @unique
  projectId Int
  project   Project @relation(fields: [projectId], references: [id])
  
  activity  String
  description String?
  begin     DateTime
  end       DateTime
  duration  Int      // seconds
  
  synced    Boolean  @default(false)
  syncedAt  DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

**Key Points**:
- `kimaiId` is unique (enables upsert)
- `synced` tracks Notion sync status
- `updatedAt` for change detection

---

## Error Handling

**Principle**: Sync operations should be **resilient**. Never lose data.

```typescript
// Generic retry wrapper
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000,
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
    }
  }
}

// Usage in Kimai service
async getTimeEntries(start: Date, end: Date) {
  return withRetry(() => 
    this.http.get(`${this.url}/timesheets`, { /* params */ }).toPromise(),
  );
}
```

**BullMQ Retry Strategy**:

```typescript
// jobs.module.ts
BullModule.registerQueue({
  name: 'sync-jobs',
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000, // 2s, 4s, 8s
    },
  },
})
```

---

## Code Style & Readability

1. **Explicit naming**: Avoid abbreviations
   - ✅ `getTimeEntries`, `syncToNotion`, `calculateDuration`
   - ❌ `getTEs`, `s2N`, `calcDur`

2. **Simple logic**: Single responsibility per function. Max 20 lines.

3. **Comments for "why"**, not "what":
   ```typescript
   // ✅ Good
   // Upsert prevents duplicate syncs if job retries
   await prisma.timeEntry.upsert(...)

   // ❌ Bad
   // Update or create time entry
   await prisma.timeEntry.upsert(...)
   ```

4. **Type everything**:
   ```typescript
   // ✅ Good
   async syncEntry(entry: KimaiTimeEntry): Promise<NotionResult> {}

   // ❌ Bad
   async syncEntry(entry: any): Promise<any> {}
   ```

5. **Logging**: Use NestJS Logger with context
   ```typescript
   private logger = new Logger(SyncService.name);
   this.logger.log('Starting sync...');
   this.logger.error('Sync failed:', error);
   ```

---

## Testing Pattern

```typescript
// sync.service.spec.ts
describe('SyncService', () => {
  let service: SyncService;
  let kimai: KimaiService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        SyncService,
        { provide: KimaiService, useValue: { getTimeEntries: jest.fn() } },
        { provide: PrismaService, useValue: { timeEntry: { upsert: jest.fn() } } },
      ],
    }).compile();

    service = module.get(SyncService);
    kimai = module.get(KimaiService);
    prisma = module.get(PrismaService);
  });

  it('should sync entries and save to DB', async () => {
    // Arrange
    const mockEntries = [{ id: 1, project: { id: 1, name: 'Project' } }];
    jest.spyOn(kimai, 'getTimeEntries').mockResolvedValue(mockEntries);

    // Act
    const result = await service.syncCurrentWeek();

    // Assert
    expect(result.synced).toBe(1);
    expect(prisma.timeEntry.upsert).toHaveBeenCalled();
  });
});
```

---

## Environment Variables

```env
# Kimai
KIMAI_URL=https://kimai.example.com
KIMAI_API_KEY=your_api_key

# PostgreSQL (Prisma)
DATABASE_URL=postgresql://user:pass@localhost:5432/kimai_sync

# Notion
NOTION_API_KEY=your_notion_key

# Redis (BullMQ)
REDIS_URL=redis://localhost:6379

# App
PORT=3000
NODE_ENV=development
LOG_LEVEL=debug
SYNC_INTERVAL=*/5 * * * *  # Cron expression
```

---

## Running the Application

```bash
# Setup
npm install
npx prisma migrate dev

# Run
npm run start:dev

# Trigger full sync (manual)
curl -X POST http://localhost:3000/sync/full

# Trigger weekly sync (manual)
curl -X POST http://localhost:3000/sync/weekly

# Scheduled sync runs automatically every 5 minutes
```

---

## Summary

- **Simple modules**, clear responsibilities
- **Resilient sync** with retries and error handling
- **Two sync modes**: on-demand (full history) + scheduled (weekly, every 5 min)
- **Readable code**: explicit naming, type safety, proper logging
- **Notion integration** per project with configurable templates
- **Idempotent operations** via Prisma upsert
