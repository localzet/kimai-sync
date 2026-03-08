# Kimai Sync - Database Schema Reference

## Overview

The Kimai Sync application uses PostgreSQL with Prisma ORM. The schema is designed for:

1. **Idempotent syncing** - Safe to re-run sync jobs without creating duplicates
2. **Efficient weekly queries** - Optimized indexes for finding unsynced entries in date ranges
3. **Notion integration** - Track sync status and store Notion page IDs
4. **Data consistency** - Cascading deletes prevent orphaned records

---

## Models

### `Project`

Maps Kimai projects to Notion databases.

| Field | Type | Notes |
|-------|------|-------|
| `id` | Int | Auto-increment primary key |
| `kimaiId` | Int | **Unique** Kimai project ID (for idempotent operations) |
| `name` | String(255) | Project name from Kimai |
| `description` | String? | Optional project description |
| `notionDatabaseId` | UUID? | Notion database ID for this project |
| `notionDatabaseUrl` | String? | Direct URL to Notion database |
| `isActive` | Boolean | Filter for active projects (default: true) |
| `createdAt` | DateTime | When record was created |
| `updatedAt` | DateTime | When record was last modified |
| `lastSyncedAt` | DateTime? | Timestamp of last successful sync |

**Relations:**
- `timeEntries`: One-to-Many with TimeEntry (cascading delete)

**Indexes:**
```sql
-- Unique index (primary constraint)
UNIQUE (kimaiId)

-- Performance indexes
INDEX (kimaiId)
INDEX (notionDatabaseId)
INDEX (isActive)
INDEX (createdAt)
INDEX (isActive, createdAt)  -- Compound
```

---

### `TimeEntry`

Stores Kimai time entries with complete sync tracking.

| Field | Type | Notes |
|-------|------|-------|
| `id` | Int | Auto-increment primary key |
| `kimaiId` | Int | **Unique** Kimai time entry ID |
| `projectId` | Int | **Foreign Key** → Project.id (cascade delete) |
| `activity` | String(255) | Activity/task name |
| `description` | String? | Optional description |
| `tags` | String(255)? | Comma-separated tags |
| `begin` | DateTime | Start time (UTC, 3ms precision) |
| `end` | DateTime? | End time (UTC, nullable for ongoing) |
| `duration` | Int | Duration in seconds |
| `synced` | Boolean | Whether synced to Notion (default: false) |
| `syncedAt` | DateTime? | Timestamp of last successful Notion sync |
| `notionPageId` | UUID? | Notion page ID after sync |
| `notionPageUrl` | String? | Direct URL to Notion page |
| `createdAt` | DateTime | When record was created |
| `updatedAt` | DateTime | When record was last modified |

**Relations:**
- `project`: Many-to-One with Project (cascade delete on project removal)

**Unique Constraints:**
```sql
-- Enable idempotent upsert by Kimai ID
UNIQUE (kimaiId)
```

**Indexes (Critical for Performance):**

| Index | Columns | Purpose |
|-------|---------|---------|
| Primary | `kimaiId` | Idempotent upsert lookups |
| FK Lookup | `projectId` | Join with Project, list entries by project |
| Sync Status | `synced` | Count/find entries needing sync |
| **Date Range** | `begin` | Weekly sync queries (filter by week) |
| **Compound** | `(synced, begin)` | Find unsync'd entries in a week |
| **Compound** | `(synced, begin, projectId)` | Full weekly sync with project filter |
| **Compound** | `(projectId, begin)` | List entries by project + date |
| Notion Lookup | `notionPageId` | Find entry by Notion page |
| Audit | `(synced, syncedAt)` | Find recently synced entries |
| Pagination | `createdAt` | Sort newest first |

---

## Query Patterns & Indexes

### Pattern 1: Idempotent Upsert (Most Common)

**Query:**
```typescript
await prisma.timeEntry.upsert({
  where: { kimaiId: entry.id },
  update: { /* changes */ },
  create: { /* new entry */ },
});
```

**Index Used:** `UNIQUE (kimaiId)`

**Why:** Only way to safely re-run sync without duplicates.

---

### Pattern 2: Weekly Sync - Find All Unsynced

**Query:**
```typescript
await prisma.timeEntry.findMany({
  where: {
    synced: false,
    begin: { gte: weekStart, lt: weekEnd },
  },
});
```

**Index Used:** `INDEX (synced, begin)` (Composite)

**Performance:** O(log n) index lookup + range scan

**Execution Plan (PostgreSQL):**
```
Index Scan using timeentry_synced_begin_idx
  Index Cond: (synced = false AND begin >= '2024-01-01' AND begin < '2024-01-08')
```

---

### Pattern 3: Weekly Sync - By Project

**Query:**
```typescript
await prisma.timeEntry.findMany({
  where: {
    projectId: 123,
    synced: false,
    begin: { gte: weekStart, lt: weekEnd },
  },
});
```

**Index Used:** `INDEX (synced, begin, projectId)` (Composite)

**Performance:** O(log n) index lookup → very fast

---

### Pattern 4: List Entries for Project

**Query:**
```typescript
await prisma.timeEntry.findMany({
  where: { projectId: 123 },
  orderBy: { begin: 'desc' },
});
```

**Indexes Used:** 
1. `INDEX (projectId)` - Find matching rows
2. `INDEX (begin)` - Sort results

**Alternative:** Use composite index for better performance:
```sql
CREATE INDEX idx_timeentry_projectid_begin ON TimeEntry(projectId, begin DESC);
```

---

### Pattern 5: Update Sync Status (Batch)

**Query:**
```typescript
await prisma.timeEntry.updateMany({
  where: { id: { in: [1, 2, 3] } },
  data: { synced: true, syncedAt: new Date() },
});
```

**Index Used:** None needed (primary key lookup by id)

**Performance:** O(1) per record

---

### Pattern 6: Full History (Last 3 Years)

**Query:**
```typescript
await prisma.timeEntry.findMany({
  where: {
    projectId: 123,
    begin: { gte: threeYearsAgo },
  },
  orderBy: { begin: 'desc' },
});
```

**Indexes Used:** 
1. `INDEX (projectId, begin)` - Initial filter
2. Returns all rows matching condition, sorts by date

**Note:** May require pagination for large result sets.

---

## Performance Considerations

### Index Design Rationale

1. **Synced + Begin (Compound)**
   - Most critical for weekly sync job
   - Filters ~99% of rows in typical use
   - Enables efficient date range queries

2. **ProjectId**
   - Supports project-specific queries
   - Required for foreign key integrity

3. **KimaiId (Unique)**
   - Enables upsert (idempotent sync)
   - Guarantees no duplicates

4. **NotionPageId**
   - Fast lookup after sync
   - Enables verification queries

### Avoiding N+1 Queries

Use `include` to fetch related data:

```typescript
// ❌ Bad: N+1 queries
const entries = await prisma.timeEntry.findMany({ where: { projectId: 123 } });
for (const entry of entries) {
  const project = await prisma.project.findUnique({ where: { id: entry.projectId } });
}

// ✅ Good: Single query with JOIN
const entries = await prisma.timeEntry.findMany({
  where: { projectId: 123 },
  include: { project: true },
});
```

### Pagination for Large Result Sets

```typescript
const page = 1;
const pageSize = 100;

const entries = await prisma.timeEntry.findMany({
  where: { projectId: 123 },
  skip: (page - 1) * pageSize,
  take: pageSize,
  orderBy: { begin: 'desc' },
});
```

---

## Data Types & Constraints

### DateTime Precision

All timestamps use **millisecond precision** (`@db.Timestamp(3)`):
- PostgreSQL: `TIMESTAMP(3) WITH TIME ZONE`
- JavaScript: `Date` objects (converted to/from ISO 8601)
- Timezone: All stored in UTC

```typescript
// Always use UTC
const utcDate = new Date('2024-01-15T10:30:00Z');
```

### Duration (Int, Seconds)

- **Range:** 0 to 2,147,483,647 seconds (68+ years)
- **Storage:** 4 bytes
- **Conversion:** `duration = (end - begin) in milliseconds / 1000`

```typescript
const duration = Math.floor((entry.end - entry.begin) / 1000);
```

### IDs (Kimai vs Database)

| ID Type | Source | Usage |
|---------|--------|-------|
| `id` (Int, auto) | Database | Internal Primary Key |
| `kimaiId` (Int, unique) | Kimai API | External identifier, upsert key |
| `notionPageId` (UUID) | Notion API | Notion page reference |

### Cascade Delete

Deleting a Project automatically deletes all associated TimeEntry records:

```typescript
await prisma.project.delete({ where: { id: 123 } });
// ➜ All TimeEntry records with projectId = 123 are deleted
// ➜ Database ensures referential integrity
```

---

## Sync Workflow & Schema Support

### Idempotent Full Sync (Last 3 Years)

```
1. Fetch entries from Kimai API (no date filter)
2. For each entry:
   upsert({ where: { kimaiId }, update: {...}, create: {...} })
3. Safe to re-run → no duplicates created
```

**Schema Support:** `UNIQUE (kimaiId)` on both Project and TimeEntry

---

### Efficient Weekly Sync (Every 5 Minutes)

```
1. Calculate: weekStart = Monday, weekEnd = next Monday
2. Find unsynced entries:
   WHERE synced = false AND begin >= weekStart AND begin < weekEnd
3. For each entry:
   - Sync to Notion (async)
   - Update database: synced = true, syncedAt = now(), notionPageId = ...
4. Query uses index: (synced, begin)
```

**Schema Support:**
- `synced` boolean flag + `syncedAt` timestamp
- Composite index `(synced, begin)` for efficient date range queries
- `notionPageId` field for Notion page tracking

---

## Migration Strategy

### Initial Setup

```bash
# 1. Configure .env with DATABASE_URL
echo 'DATABASE_URL="postgresql://user:pass@localhost:5432/kimai_sync"' > .env

# 2. Create initial migration
npx prisma migrate dev --name init

# 3. Generate Prisma Client
npx prisma generate
```

### Ongoing Changes

```bash
# After modifying schema.prisma:
npx prisma migrate dev --name descriptive_change_name

# Example:
npx prisma migrate dev --name add_notion_url_field
```

### Production Deployment

```bash
# Apply all pending migrations
npx prisma migrate deploy

# Or use push (no migration history: not reversible)
npx prisma db push
```

---

## Monitoring & Maintenance

### Check Index Usage

```sql
-- Find unused indexes
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public' AND indexname NOT LIKE 'pg_toast%'
ORDER BY tablename;

-- Check index size
SELECT indexname, pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;
```

### Analyze Query Performance

```bash
# Enable query logging in Prisma
PRISMA_LOG_LEVEL=query npx ts-node app.ts

# Or use EXPLAIN:
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM "TimeEntry"
WHERE synced = false AND begin >= '2024-01-01'::timestamp;
```

### Maintenance Tasks

```bash
# Reindex (PostgreSQL)
REINDEX TABLE "TimeEntry";
REINDEX TABLE "Project";

# Vacuum (cleanup dead rows)
VACUUM ANALYZE "TimeEntry";
VACUUM ANALYZE "Project";
```

---

## Security Considerations

1. **Environment Variables:** Never commit `.env` files
2. **Database User:** Use least-privilege credentials
3. **Connection Pooling:** Use PgBouncer or similar for production
4. **Backups:** Enable automated PostgreSQL backups
5. **Audit Trail:** `createdAt`, `updatedAt` fields for compliance

---

## Related Documentation

- [Prisma Schema Reference](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference)
- [PostgreSQL Indexing](https://www.postgresql.org/docs/current/indexes.html)
- [Prisma ORM Guide](https://www.prisma.io/docs/orm/overview/introduction/what-is-prisma)
- [Kimai API Documentation](https://kimai.org/documentation/api/)
- [Notion API Reference](https://developers.notion.com/reference/intro)
