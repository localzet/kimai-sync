# Kimai Sync - Visual Architecture Reference

## 1. Module Dependency Graph

```
┌────────────────────────────────────────────────────────────────────────┐
│                         ROOT APPLICATION                              │
│                         (app.module.ts)                               │
└──────────────────────────┬─────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┬──────────────────┐
        │                  │                  │                  │
        ▼                  ▼                  ▼                  ▼
    ┌────────┐         ┌────────┐        ┌────────┐        ┌────────┐
    │ Config │         │Kimai   │        │Database│        │Notion  │
    │ Module │         │Module  │        │Module  │        │Module  │
    └────────┘         └────┬───┘        └────┬───┘        └────┬───┘
        │                   │                 │                 │
        ├─ KimaiConfig      ├──── uses ───────┴────────────────┘
        │                   │           (HTTP, retry)
        ├─ NotionConfig     │
        │                   │           (Prisma ORM)
        │-DatabaseConfig    ▼
        │            ┌──────────────┐
        │            │KimaiService  │
        │            │KimaiClient   │
        │            └──────────────┘
        │
        ├─ RedisConfig
        │
        ▼ (all configs injected here)
    ┌────────────────┐
    │  Sync Module   │
    │ (ORCHESTRATOR) │
    └────┬───────────┘
         │
         ├─ Imports KimaiService
         ├─ Imports PrismaService
         ├─ Imports NotionService
         │
         ├─ SyncService
         │  ├─ syncFullHistory()
         │  ├─ syncCurrentWeek()
         │  └─ processEntries()
         │
         └─ SyncController
            ├─ POST /sync/full
            ├─ POST /sync/weekly
            └─ GET /sync/status

        ▼ (feeds jobs)
    ┌────────────────┐
    │  Jobs Module   │
    │  (SCHEDULER)   │
    └────────────────┘
         │
         ├─ SyncFullJobHandler
         ├─ SyncWeeklyJobHandler
         ├─ ScheduledSyncProvider (cron)
         └─ BullModule.registerQueue()


    ┌─ DEPENDENCY FLOW (UNIDIRECTIONAL) ─┐
    │                                      │
    │  config/  (no deps)                 │
    │      ↑                              │
    │      │                              │
    │  kimai/, database/, notion/         │
    │      ↑                              │
    │      │                              │
    │    sync/                            │
    │      ↑                              │
    │      │                              │
    │    jobs/                            │
    │      ↑                              │
    │      │                              │
    │  app.module.ts (root)               │
    │                                      │
    │  ✓ NO CIRCULAR DEPENDENCIES         │
    └──────────────────────────────────────┘
```

---

## 2. Service Injection Hierarchy

```
app.module.ts
│
├─ imports: [ConfigModule]
│  │
│  └─ providers:
│     ├─ KimaiConfig (singleton)
│     ├─ NotionConfig (singleton)
│     ├─ DatabaseConfig (singleton)
│     └─ RedisConfig (singleton)
│
├─ imports: [DatabaseModule]
│  │
│  └─ DatabaseModule.register()
│     ├─ depends on: DatabaseConfig
│     ├─ providers:
│     │  └─ PrismaService (singleton)
│     └─ exports: [PrismaService]
│
├─ imports: [KimaiModule]
│  │
│  └─ KimaiModule.register()
│     ├─ depends on: KimaiConfig, HttpModule
│     ├─ providers:
│     │  ├─ KimaiClient (provided)
│     │  └─ KimaiService
│     └─ exports: [KimaiService]
│
├─ imports: [NotionModule]
│  │
│  └─ NotionModule.register()
│     ├─ depends on: NotionConfig, HttpModule
│     ├─ providers:
│     │  ├─ NotionClient (provided)
│     │  └─ NotionService
│     └─ exports: [NotionService]
│
├─ imports: [SyncModule]
│  │
│  └─ SyncModule.register()
│     ├─ imports: [KimaiModule, DatabaseModule, NotionModule]
│     ├─ providers:
│     │  ├─ SyncService
│     │  │  ├─ constructor(
│     │  │  │    @Inject(KimaiService) kimai,
│     │  │  │    @Inject(PrismaService) prisma,
│     │  │  │    @Inject(NotionService) notion,
│     │  │  │  )
│     │  │  └─ Responsibility: orchestration
│     │  └─ SyncController
│     │     ├─ constructor(@InjectQueue('sync-jobs') queue)
│     │     └─ Responsibility: HTTP endpoints
│     └─ exports: [SyncService]
│
└─ imports: [JobsModule]
   │
   └─ JobsModule.register()
      ├─ imports: [SyncModule]
      ├─ imports: [BullModule.registerQueue('sync-jobs')]
      ├─ providers:
      │  ├─ SyncFullJobHandler
      │  │  ├─ constructor(@Inject(SyncService) sync)
      │  │  └─ @Process('sync-full')
      │  ├─ SyncWeeklyJobHandler
      │  │  ├─ constructor(@Inject(SyncService) sync)
      │  │  └─ @Process('sync-weekly')
      │  └─ ScheduledSyncProvider
      │     ├─ constructor(@InjectQueue('sync-jobs') queue)
      │     └─ onModuleInit(): cron.schedule()
      └─ controllers: [SyncController] (from SyncModule)
```

---

## 3. Data Flow - Full Sync

```
CLIENT REQUEST:
  POST /sync/full
  │
  ├─ SyncController.triggerFullSync()
  │  │
  │  ├─ Create job: { type: 'sync-full', payload: {} }
  │  ├─ Add to BullMQ queue
  │  │  │
  │  │  └─ await queue.add('sync-full', {}, jobOptions)
  │  │
  │  └─ Return: { jobId: 123, status: 'queued' }
  │
  └─ RESPONSE: 202 Accepted


BACKGROUND JOB PROCESSING:
  BullMQ Worker picks up job
  │
  └─ SyncFullJobHandler.handleFullSync(job)
     │
     ├─ START: call SyncService.syncFullHistory()
     │
     ├─ STEP 1: Fetch from Kimai
     │  │
     │  └─ KimaiService.getTimeEntries(start, end)
     │     ├─ Calculate: start = now - 3 years, end = now
     │     ├─ Call: withRetry(() => HTTP GET /timesheets?begin=X&end=Y)
     │     ├─ Handle pagination: fetch all pages
     │     ├─ Return: KimaiTimeEntry[]
     │     │
     │     └─ ERROR HANDLING:
     │        ├─ 401/403: throw KimaiAuthenticationError (no retry)
     │        ├─ 404: throw KimaiNotFoundError (no retry)
     │        ├─ Network error: retry 3x with backoff (1s, 2s, 4s)
     │        └─ Timeout: throw KimaiConnectionError
     │
     ├─ STEP 2: Process each entry
     │  │
     │  └─ For each KimaiTimeEntry in entries:
     │     │
     │     ├─ Transform to database model
     │     │  ├─ kimaiId → identifier
     │     │  ├─ project.id → projectId (lookup in DB)
     │     │  ├─ begin/end/duration → timestamps
     │     │  └─ Create EntryTransform object
     │     │
     │     ├─ STEP 2a: Save to PostgreSQL (critical)
     │     │  │
     │     │  └─ PrismaService.timeEntry.upsert()
     │     │     ├─ WHERE: kimaiId = X
     │     │     ├─ UPDATE: if exists (updated fields)
     │     │     ├─ CREATE: if new
     │     │     │
     │     │     └─ ERROR HANDLING:
     │     │        ├─ Constraint violation: throw DatabaseConstraintError
     │     │        ├─ Connection lost: throw DatabaseError (auto-retry)
     │     │        └─ If error: count as FAILED, log, continue next entry
     │     │
     │     └─ STEP 2b: Sync to Notion (non-critical, async)
     │        │
     │        └─ NotionService.syncEntry(entry) (fire-and-forget)
     │           ├─ Get template: templates.get(projectId)
     │           ├─ If not found: log warn, skip
     │           ├─ Build Notion page payload
     │           ├─ HTTP POST https://api.notion.com/v1/pages
     │           │
     │           └─ ERROR HANDLING:
     │              ├─ Missing template: log warn, continue
     │              ├─ 404 database: log error, skip
     │              ├─ 401/403: log error
     │              ├─ 429 rate limit: log warn
     │              └─ Network error: log, don't block DB save
     │
     ├─ STEP 3: Aggregate results
     │  ├─ Count: synced = successful, failed = errors, skipped = skipped
     │  └─ Return: SyncResult { synced, failed, skipped, duration, timestamp }
     │
     └─ RETURN: { success: true, ...SyncResult }
        │
        └─ Job marked complete, removed from queue


FINAL STATE:
  ├─ PostgreSQL: All entries saved with kimaiId (idempotent)
  ├─ Notion: Entries synced to templates (async, may still be pending)
  ├─ Job Queue: Job removed (if removeOnComplete: true)
  ├─ Client: Can query GET /sync/status to check results
  └─ Logs: Full trace of what happened
```

---

## 4. Data Flow - Weekly Scheduled Sync

```
CRON TRIGGER (every 5 minutes):
  node-cron schedule: '*/5 * * * *'
  │
  ├─ ScheduledSyncProvider.onModuleInit()
  │  └─ Sets up cron at app startup
  │
  └─ Every 5 minutes → cron callback fires:
     │
     ├─ Check if job already running
     │  └─ Prevent duplicate overlaps
     │
     ├─ Queue job: { type: 'sync-weekly', payload: {} }
     │  └─ await queue.add('sync-weekly', {}, jobOptions)
     │
     └─ If queue not busy: process immediately
        Otherwise: queue waits for slot


JOB PROCESSING:
  BullMQ Worker picks up job
  │
  └─ SyncWeeklyJobHandler.handleWeeklySync(job)
     │
     ├─ START: call SyncService.syncCurrentWeek()
     │
     ├─ Calculate date range:
     │  ├─ start = Monday of current week
     │  ├─ end = Monday + 7 days
     │  └─ Example: Mon 2024-01-08 to Mon 2024-01-15
     │
     ├─ STEP 1: Fetch from Kimai (last 7 days)
     │  └─ KimaiService.getRecentEntries(days: 7)
     │     ├─ HTTP GET /timesheets?begin=X&end=Y
     │     ├─ Same retry logic as full sync
     │     └─ Return: KimaiTimeEntry[]
     │
     ├─ STEP 2: Process each entry
     │  └─ Same as full sync (upsert to DB, async to Notion)
     │
     └─ RETURN: SyncResult


JOB RETRY BEHAVIOR:
  On error during job execution:
  │
  ├─ Attempt 1: Execute, fail → Log error
  │  ├─ Wait: 2 seconds
  │  └─ Retry
  │
  ├─ Attempt 2: Execute, fail → Log error
  │  ├─ Wait: 4 seconds
  │  └─ Retry
  │
  ├─ Attempt 3: Execute, fail → Log error
  │  ├─ Wait: 8 seconds
  │  └─ Retry
  │
  └─ Final failure: Move to failed queue, log, alert


SCHEDULED TIMELINE:
  Time     │ Event
  ─────────┼───────────────────────────────────
  00:00    │ Job 1: queue
  00:01    │ Job 1: running (sync takes ~30-60s)
  00:05    │ Job 2: queue (Job 1 still running)
  00:02    │ Job 1: done ✓
  00:05    │ Job 2: start processing
  00:05    │ Job 3: queue
  00:06    │ Job 2: done ✓
  00:10    │ Job 3: start processing
  00:10    │ Job 4: queue
  ...
  
  Result: No overlapping syncs, queue is FIFO
```

---

## 5. Database Schema Relationship Diagram

```
┌──────────────────────────────────┐
│          Project                 │
├──────────────────────────────────┤
│ id (PK)            [auto]        │
│ kimaiId (UNIQUE)   [from Kimai]  │
│ name               [string]      │
│ notionDbId         [optional]    │
│ createdAt          [timestamp]   │
│ updatedAt          [timestamp]   │
└────────────────┬──────────────────┘
                 │
                 │ 1:N
                 │ (Project has many TimeEntries)
                 │
┌────────────────▼──────────────────┐
│       TimeEntry                   │
├───────────────────────────────────┤
│ id (PK)               [auto]      │
│ kimaiId (UNIQUE)      [from API]  │ ◄─ Idempotent key
│ projectId (FK)        [→Project]  │
│ activity              [string]    │
│ description           [optional]  │
│ begin                 [datetime]  │
│ end                   [datetime]  │
│ duration              [seconds]   │
│ synced                [boolean]   │ ◄─ Notion sync flag
│ syncedAt              [timestamp] │
│ createdAt             [timestamp] │
│ updatedAt             [timestamp] │
└───────────────────────────────────┘

Indexes:
  - TimeEntry(kimaiId) [unique, fast upsert lookup]
  - TimeEntry(projectId) [foreign key]
  - TimeEntry(synced) [query unsynced entries]
  - TimeEntry(begin, end) [range queries for sync period]

Relationships:
  ┌─ Project.kimaiId ◄─── Source: Kimai API /projects
  │
  └─ TimeEntry
      ├─ kimaiId ◄───────── Source: Kimai API /timesheets
      ├─ projectId ◄─────── Link to Project table
      ├─ begin/end ◄─────── Source: Kimai timesheet times
      └─ synced flag ◄───── Updated after Notion POST

Sync Markers:
  - TimeEntry.synced = false initially
  - After successful Notion POST: synced = true, syncedAt = now()
  - Allows retry of failed Notion syncs
```

---

## 6. Configuration Loading Sequence

```
main.ts
│
├─ NestFactory.create(AppModule)
│  │
│  └─ AppModule initializes:
│     │
│     ├─ ConfigModule (first!)
│     │  │
│     │  └─ Load environment variables:
│     │     ├─ KIMAI_URL, KIMAI_API_KEY, KIMAI_PAGE_SIZE
│     │     ├─ DATABASE_URL, DATABASE_POOL_MIN, DATABASE_POOL_MAX
│     │     ├─ NOTION_API_KEY
│     │     ├─ REDIS_URL
│     │     ├─ LOG_LEVEL, PORT, NODE_ENV
│     │     └─ SYNC_INTERVAL
│     │
│     ├─ Create config service instances:
│     │  ├─ KimaiConfig { url, apiKey, pageSize, ... }
│     │  ├─ DatabaseConfig { databaseUrl, pool, ssl, ... }
│     │  ├─ NotionConfig { apiKey, baseUrl, ... }
│     │  └─ RedisConfig { url, retryStrategy, ... }
│     │
│     ├─ Validate configuration:
│     │  ├─ Check all required variables set
│     │  ├─ Try connecting to PostgreSQL (test connection)
│     │  ├─ Try connecting to Redis (test connection)
│     │  └─ Validate Kimai URL format
│     │
│     ├─ If validation fails: throw error + exit
│     │
│     ├─ Initialize DatabaseModule:
│     │  ├─ Create PrismaService instance
│     │  ├─ Connect to PostgreSQL
│     │  └─ Run pending migrations (if any)
│     │
│     ├─ Initialize KimaiModule:
│     │  ├─ Create KimaiClient
│     │  └─ Create KimaiService
│     │
│     ├─ Initialize NotionModule:
│     │  ├─ Create NotionClient
│     │  └─ Create NotionService
│     │
│     ├─ Initialize SyncModule:
│     │  ├─ Create SyncService
│     │  └─ Create SyncController
│     │
│     └─ Initialize JobsModule:
│        ├─ Connect BullMQ to Redis
│        ├─ Start job handlers (listeners)
│        ├─ Register queue: 'sync-jobs'
│        └─ Start ScheduledSyncProvider (cron)
│
├─ app.listen(port)
│
└─ All modules initialized, ready for requests ✓
   GET /health should return 200
   POST /sync/weekly should queue job
```

---

## 7. Error Handling Flow

```
REQUEST:  POST /sync/weekly (user triggers sync)
│
├─ SyncController.triggerWeeklySync() ✓
│  ├─ Validate input (none required)
│  └─ Queue job
│
└─ Return response: 202 Accepted { jobId, status: 'queued' }


BACKGROUND: BullMQ executes job
│
└─ SyncWeeklyJobHandler.handleWeeklySync()
   │
   ├─ TRY: SyncService.syncCurrentWeek()
   │  │
   │  ├─ TRY: KimaiService.getRecentEntries()
   │  │  │
   │  │  └─ HTTP GET /timesheets
   │  │     │
   │  │     ├─ SUCCESS: Return entries ✓
   │  │     │
   │  │     └─ ERROR:
   │  │        ├─ 401/403 (Auth): throw KimaiAuthenticationError
   │  │        │  └─ BullMQ: no retry (marked as failed)
   │  │        │
   │  │        ├─ Network timeout: throw in withRetry wrapper
   │  │        │  ├─ Retry attempt 1 (wait 1s)
   │  │        │  ├─ Retry attempt 2 (wait 2s)
   │  │        │  ├─ Retry attempt 3 (wait 4s)
   │  │        │  └─ Final failure: throw
   │  │        │     └─ BullMQ: auto-retry job (2s, 4s, 8s)
   │  │        │
   │  │        └─ Other errors: throw
   │  │           └─ Propagate to catch block
   │  │
   │  ├─ CATCH: If Kimai failed
   │  │  └─ Throw error (abort entire sync)
   │  │     └─ Job fails → BullMQ retries
   │  │
   │  ├─ FOR EACH entry:
   │  │  │
   │  │  ├─ TRY: PrismaService.timeEntry.upsert()
   │  │  │  │
   │  │  │  ├─ WHERE: kimaiId = X
   │  │  │  ├─ UPDATE or CREATE
   │  │  │  │
   │  │  │  └─ ERROR:
   │  │  │     ├─ Constraint violation (P2002):
   │  │  │     │  └─ throw DatabaseConstraintError
   │  │  │     │     └─ Log error, count as FAILED
   │  │  │     │
   │  │  │     ├─ Connection lost:
   │  │  │     │  └─ throw DatabaseError
   │  │  │     │     └─ Job fails → BullMQ retries
   │  │  │     │
   │  │  │     └─ Other errors:
   │  │  │        └─ Propagate + count as failed
   │  │  │
   │  │  └─ CATCH: DatabaseError
   │  │     └─ Increment failed counter
   │  │        └─ Continue to next entry (partial success OK)
   │  │
   │  └─ TRY [Async, non-blocking]: NotionService.syncEntry()
   │     │
   │     └─ ERROR:
   │        ├─ Missing template: log warn, skip (OK)
   │        │
   │        ├─ 404 database: log error, skip (OK)
   │        │
   │        ├─ Rate limit (429): throw NotionRateLimitError
   │        │  └─ Don't block DB (fire-and-forget)
   │        │
   │        └─ Network error: log warn (OK)
   │           └─ Don't block DB save
   │
   └─ RETURN: SyncResult { synced: X, failed: Y, skipped: Z, ... }


JOB COMPLETION:
  ├─ On SUCCESS:
  │  ├─ Store result: job.data.result = SyncResult
  │  ├─ Mark as completed
  │  └─ Remove from queue (if removeOnComplete: true)
  │
  └─ On FAILURE:
     ├─ Attempt 1 failed (details logged)
     ├─ Wait 2 seconds
     ├─ Attempt 2 failed
     ├─ Wait 4 seconds
     ├─ Attempt 3 failed
     ├─ Wait 8 seconds
     ├─ Move to failed queue
     ├─ Log stack trace + error details
     └─ Alert (if monitoring configured)


CLIENT CHECKS STATUS:
  GET /sync/status/:jobId
  │
  ├─ SyncController.getSyncStatus(jobId)
  │  │
  │  ├─ Query BullMQ: job = queue.getJob(jobId)
  │  │
  │  └─ If found:
  │     ├─ status: 'completed' | 'failed' | 'active' | 'queued'
  │     ├─ progress: 0-100
  │     ├─ result: SyncResult (if completed)
  │     └─ error: Error message (if failed)
  │
  └─ Return: JobStatusResponse
```

---

## 8. Request/Response Examples

### POST /sync/full - Start Full Sync

```
REQUEST:
  POST /sync/full
  Content-Type: application/json
  {}

RESPONSE (202 Accepted):
  {
    "jobId": "12345",
    "status": "queued",
    "message": "Full sync job queued. Check status at GET /sync/status/12345"
  }
```

### POST /sync/weekly - Start Weekly Sync

```
REQUEST:
  POST /sync/weekly
  Content-Type: application/json
  {}

RESPONSE (202 Accepted):
  {
    "jobId": "12346",
    "status": "queued",
    "message": "Weekly sync job queued. Check status at GET /sync/status/12346"
  }
```

### GET /sync/status/:jobId - Check Job Status

```
REQUEST (while running):
  GET /sync/status/12345

RESPONSE (200 OK):
  {
    "jobId": "12345",
    "status": "active",
    "progress": 35,
    "message": "Processing 2345 of 6789 entries"
  }

---

REQUEST (completed):
  GET /sync/status/12346

RESPONSE (200 OK):
  {
    "jobId": "12346",
    "status": "completed",
    "progress": 100,
    "result": {
      "synced": 143,
      "failed": 2,
      "skipped": 5,
      "duration": 12500,
      "timestamp": "2024-01-15T14:30:00Z",
      "startDate": "2024-01-08T00:00:00Z",
      "endDate": "2024-01-15T23:59:59Z"
    }
  }

---

REQUEST (failed):
  GET /sync/status/12343

RESPONSE (200 OK):
  {
    "jobId": "12343",
    "status": "failed",
    "progress": 25,
    "error": {
      "name": "KimaiAuthenticationError",
      "message": "Invalid Kimai credentials (401)",
      "stack": "..."
    },
    "attempts": 3,
    "nextRetry": "2024-01-15T14:15:30Z"
  }
```

### GET /health - Health Check

```
REQUEST:
  GET /health

RESPONSE (200 OK):
  {
    "status": "up",
    "timestamp": "2024-01-15T14:30:00Z",
    "checks": {
      "app": {
        "status": "up",
        "message": "Application running"
      },
      "database": {
        "status": "up",
        "message": "PostgreSQL connected",
        "details": {
          "pool": "2/10",
          "uptime": "2h 34m"
        }
      },
      "redis": {
        "status": "up",
        "message": "Redis connected"
      },
      "kimai": {
        "status": "up",
        "message": "Kimai API reachable",
        "latency": "145ms"
      },
      "notion": {
        "status": "up",
        "message": "Notion API reachable",
        "latency": "234ms"
      }
    }
  }

---

RESPONSE (503 Service Unavailable - degraded):
  {
    "status": "degraded",
    "timestamp": "2024-01-15T14:30:00Z",
    "checks": {
      "app": { "status": "up" },
      "database": { "status": "down", "message": "PostgreSQL connection lost" },
      "redis": { "status": "up" },
      "kimai": { "status": "down", "message": "Connection timeout" },
      "notion": { "status": "up" }
    }
  }
```

---

## 9. Implementation Sequence Visual Timeline

```
Day 1 - Foundation
┌────────────────────────────────────────────────────────────────┐
│ Step 1: Setup NestJS project                                  │
│ Step 2: Create config services                                │
│ Step 3: Prisma + Database                                     │
│ Step 4: Type definitions                                      │
└────────────────────────────────────────────────────────────────┘

Day 2-3 - API Clients
┌────────────────────────────────────────────────────────────────┐
│ Step 5: Kimai client + service                                │
│ Step 6: Notion client + service                               │
│ Step 7: Utilities + exceptions                                │
└────────────────────────────────────────────────────────────────┘

Day 3-4 - Sync Logic
┌────────────────────────────────────────────────────────────────┐
│ Step 8: SyncService + SyncController                          │
│ Step 9: Error handling                                        │
│ Step 10: Database helpers                                    │
└────────────────────────────────────────────────────────────────┘

Day 4-5 - Jobs & Scheduling
┌────────────────────────────────────────────────────────────────┐
│ Step 11: Redis + BullMQ setup                                 │
│ Step 12: Job handlers                                        │
│ Step 13: Cron scheduler                                      │
│ Step 14: Job status endpoints                                │
└────────────────────────────────────────────────────────────────┘

Day 5-6 - Health & Monitoring
┌────────────────────────────────────────────────────────────────┐
│ Step 15: Health endpoints                                    │
│ Step 16: Logging + monitoring                                │
│ Step 17: Error tracking                                      │
└────────────────────────────────────────────────────────────────┘

Day 6-7 - Testing & Docs
┌────────────────────────────────────────────────────────────────┐
│ Step 18: Unit tests (>80%)                                   │
│ Step 19: Integration tests                                   │
│ Step 20: Documentation                                       │
└────────────────────────────────────────────────────────────────┘

Day 7+ - Deployment
┌────────────────────────────────────────────────────────────────┐
│ Step 21: Dockerfile + docker-compose                          │
│ Step 22: Environment management                              │
│ Step 23: Deployment                                          │
│ Step 24: Production validation                               │
└────────────────────────────────────────────────────────────────┘
```

---

## 10. Key Principles Recap

```
┌─────────────────────────────────────────────────────────────┐
│ PRINCIPLE 1: Single Responsibility                          │
├─────────────────────────────────────────────────────────────┤
│ ✓ kimai/ → fetch from Kimai API only                       │
│ ✓ database/ → persist to PostgreSQL only                   │
│ ✓ notion/ → sync to Notion only                            │
│ ✓ sync/ → orchestrate the above 3                          │
│ ✓ jobs/ → schedule and retry jobs                          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ PRINCIPLE 2: Dependency Injection (No Circular Deps)       │
├─────────────────────────────────────────────────────────────┤
│ config → (no deps)                                          │
│    ↓                                                         │
│ kimai, database, notion → (only config)                    │
│    ↓                                                         │
│ sync → (kimai, database, notion)                           │
│    ↓                                                         │
│ jobs → (sync)                                              │
│                                                              │
│ ✓ Clean hierarchy, testable, mockable                      │
│ ✗ NO: create instances with `new`, NO: global singletons  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ PRINCIPLE 3: Idempotent Operations                          │
├─────────────────────────────────────────────────────────────┤
│ ✓ Prisma.upsert() with kimaiId as key                      │
│ ✓ Safe to retry, no duplicates                             │
│ ✓ BullMQ can retry 3x without issues                       │
│ ✓ Scheduled job runs every 5 min, safe                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ PRINCIPLE 4: Error Handling (Critical vs Non-Critical)     │
├─────────────────────────────────────────────────────────────┤
│ CRITICAL (DB):                                              │
│   └─ If fails: abort entire sync, retry job                │
│                                                              │
│ CRITICAL (Kimai):                                           │
│   └─ If fails: abort entire sync, retry job                │
│                                                              │
│ NON-CRITICAL (Notion):                                      │
│   └─ If fails: log and continue, no retry required         │
│                                                              │
│ ✓ Partial success is OK                                    │
│ ✓ Data in DB is always the source of truth                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ PRINCIPLE 5: Configuration is Environment-Driven           │
├─────────────────────────────────────────────────────────────┤
│ ✓ All settings: environment variables                       │
│ ✓ No hardcoded secrets (KIMAI_API_KEY, DATABASE_URL, etc) │
│ ✓ Config services initialized once at startup              │
│ ✓ Use different .env files for dev/test/prod              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ PRINCIPLE 6: Clear Data Flow                               │
├─────────────────────────────────────────────────────────────┤
│ Kimai → Sync → DB (PRIMARY, must succeed)                  │
│                ↓                                             │
│              Notion (SECONDARY, best-effort)               │
│                                                              │
│ ✓ PostgreSQL is single source of truth                     │
│ ✓ Notion is synchronized replica                          │
│ ✓ Loss of Notion sync ≠ data loss                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Summary

This visual reference provides:
- 📊 **Module dependencies** (no circular refs)
- 💉 **Service injection hierarchy** (clear provider flow)
- 🔄 **Data flow diagrams** (full sync, weekly sync)
- 📦 **Database schema** (relationships & idempotent keys)
- ⚙️ **Configuration loading** (startup sequence)
- ❌ **Error handling** (retry logic, graceful degradation)
- 📝 **API examples** (request/response)
- 📅 **Implementation timeline** (7-day plan)
- ✅ **Core principles** (single responsibility, DI, errors)

Use this alongside `MODULE_ARCHITECTURE.md` for detailed implementation steps.
