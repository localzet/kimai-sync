# Prisma Migrations Guide

This directory contains Prisma migrations for the Kimai Sync application database schema.

## Initial Setup

### 1. Configure Database Connection

Create a `.env` file in the project root based on `.env.example`:

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/kimai_sync?schema=public"
```

### 2. Create Initial Migration

Run this command to create the initial migration from the schema:

```bash
npx prisma migrate dev --name init
```

This will:
- Create the migration files
- Create the PostgreSQL database and schema
- Run all migrations
- Generate Prisma Client

### 3. Push to Production (without migration tracking)

For production environments, use:

```bash
npx prisma db push
```

**Note**: `db push` is useful for prototyping but doesn't create migration files. Use `migrate dev` for collaborative development.

## Common Commands

### View Current Schema Status
```bash
npx prisma db pull
```

### Create a New Migration (after schema changes)
```bash
npx prisma migrate dev --name <descriptive_name>
```

Example:
```bash
npx prisma migrate dev --name add_kimai_sync_tracking
```

### See Migration History
```bash
npx prisma migrate status
```

### Safe Reset (Development Only)
```bash
npx prisma migrate reset
```

**Warning**: This drops the database and recreates it. Only use in development!

### Apply Pending Migrations (CI/CD)
```bash
npx prisma migrate deploy
```

### Preview migration
```bash
npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource
```

## Schema Overview

### Project Model
- Storage for Kimai projects mapped to Notion databases
- Fields: `kimaiId` (unique), `name`, `notionDatabaseId`, `isActive`, timestamps
- Relations: `1:N` with TimeEntry (cascading delete)

### TimeEntry Model
- Storage for Kimai time entries with sync tracking
- Fields:
  - **Kimai data**: `kimaiId` (unique), `activity`, `description`, `tags`
  - **Time tracking**: `begin`, `end`, `duration` (in seconds)
  - **Sync tracking**: `synced` (boolean), `syncedAt` (timestamp)
  - **Notion integration**: `notionPageId`, `notionPageUrl`
- Relations: `N:1` with Project (cascading delete)

### Indexes for Performance

**TimeEntry Indexes** (optimized for sync queries):
- `@@unique([kimaiId])` - Idempotent upsert lookups
- `@@index([synced])` - Find entries needing sync
- `@@index([begin])` - Date range filtering (weekly sync)
- `@@index([synced, begin])` - Combined: find unsync'd entries in a date range
- `@@index([projectId, begin])` - Filter entries by project and date
- `@@index([synced, begin, projectId])` - Full weekly sync query

**Project Indexes**:
- `@@unique([kimaiId])` - Unique project identifier
- `@@index([isActive])` - Filter active projects
- `@@index([isActive, createdAt])` - List active projects by creation date

## Cascading Deletes

When a Project is deleted, all associated TimeEntry records are automatically deleted:

```typescript
project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
```

This ensures data consistency without orphaned time entries.

## Idempotent Upserts

Use the unique `kimaiId` field for safe re-runs:

```typescript
await prisma.timeEntry.upsert({
  where: { kimaiId: entry.id },      // Idempotent key
  update: {
    activity: entry.activity,
    duration: entry.duration,
    end: new Date(entry.end),
    updatedAt: new Date(),
  },
  create: {
    kimaiId: entry.id,
    projectId: projectId,
    activity: entry.activity,
    description: entry.description,
    begin: new Date(entry.begin),
    end: new Date(entry.end),
    duration: entry.duration,
  },
});
```

## Weekly Sync Queries

Efficient queries for the weekly sync job:

### Find all unsynced entries in a date range:
```typescript
const unsynced = await prisma.timeEntry.findMany({
  where: {
    synced: false,
    begin: {
      gte: weekStart,
      lt: weekEnd,
    },
  },
});
```
Uses index: `@@index([synced, begin])`

### Find unsynced entries for a specific project:
```typescript
const unsynced = await prisma.timeEntry.findMany({
  where: {
    projectId: projectId,
    synced: false,
    begin: {
      gte: weekStart,
      lt: weekEnd,
    },
  },
});
```
Uses index: `@@index([synced, begin, projectId])`

### Update sync status:
```typescript
await prisma.timeEntry.updateMany({
  where: {
    id: { in: syncedIds },
  },
  data: {
    synced: true,
    syncedAt: new Date(),
    notionPageId: pageId,  // Optional: set Notion page ID
  },
});
```

## Data Types & Ranges

- **DateTime**: ISO 8601 timestamps with 3ms precision (`@db.Timestamp(3)`)
- **Duration (Int)**: Time in seconds (0 to 2,147,483,647 = ~68 years max per entry)
- **UUIDs (String)**: Notion database and page IDs stored as Uuid strings
- **VarChar(255)**: Project and activity names (limits prevent abuse)
- **Text**: Descriptions and URLs (unlimited length)

## Additional Resources

- [Prisma Documentation](https://www.prisma.io/docs/)
- [PostgreSQL Best Practices](https://www.postgresql.org/docs/current/ddl.html)
- [Index Strategy Guide](https://use-the-index-luke.com/)
