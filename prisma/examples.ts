/*
 * TYPE-SAFE DATABASE QUERYING EXAMPLES
 * 
 * These examples show how to use Prisma for common sync operations.
 * All queries are type-checked at compile time.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================================================
// EXAMPLES - Use these patterns in your sync service
// ============================================================================

/**
 * EXAMPLE 1: Idempotent Upsert by Kimai ID
 * 
 * Safe to call multiple times with the same Kimai entry.
 * Creates if not found, updates if it already exists.
 */
async function upsertTimeEntry(entry: any, projectId: number) {
  return await prisma.timeEntry.upsert({
    where: { kimaiId: entry.id },  // Unique identifier
    update: {
      activity: entry.activity,
      description: entry.description || null,
      tags: entry.tags?.join(',') || null,
      begin: new Date(entry.begin),
      end: entry.end ? new Date(entry.end) : null,
      duration: entry.duration || 0,
      updatedAt: new Date(),
    },
    create: {
      kimaiId: entry.id,             // Must be unique
      projectId: projectId,
      activity: entry.activity,
      description: entry.description || null,
      tags: entry.tags?.join(',') || null,
      begin: new Date(entry.begin),
      end: entry.end ? new Date(entry.end) : null,
      duration: entry.duration || 0,
      synced: false,                 // Not yet synced to Notion
    },
  });
}

/**
 * EXAMPLE 2: Weekly Sync - Find All Unsynced Entries
 * 
 * Gets all entries that haven't been synced to Notion yet
 * within the current week.
 */
async function getUnscyncedWeeklyEntries(weekStart: Date, weekEnd: Date) {
  return await prisma.timeEntry.findMany({
    where: {
      synced: false,
      begin: {
        gte: weekStart,
        lt: weekEnd,
      },
    },
    include: {
      project: true,  // Include project details
    },
    orderBy: {
      begin: 'asc',  // Oldest first
    },
  });
}

/**
 * EXAMPLE 3: Weekly Sync - Project-Specific
 * 
 * Gets unsynced entries for a specific project
 * (useful if syncing per-project).
 */
async function getUnsyncedEntriesByProject(
  projectId: number,
  weekStart: Date,
  weekEnd: Date,
) {
  return await prisma.timeEntry.findMany({
    where: {
      projectId: projectId,
      synced: false,
      begin: {
        gte: weekStart,
        lt: weekEnd,
      },
    },
    orderBy: {
      begin: 'asc',
    },
  });
}

/**
 * EXAMPLE 4: Update Multiple Entries After Notion Sync
 * 
 * Mark entries as synced after successful Notion sync.
 * Updates sync timestamp and optionally stores Notion page ID.
 */
async function markEntriesSynced(
  entryIds: number[],
  notionPageIds?: Map<number, string>,
) {
  for (const entryId of entryIds) {
    await prisma.timeEntry.update({
      where: { id: entryId },
      data: {
        synced: true,
        syncedAt: new Date(),
        notionPageId: notionPageIds?.get(entryId),
      },
    });
  }
}

/**
 * EXAMPLE 5: Batch Update (More Efficient)
 * 
 * Update multiple entries in a single query (faster).
 */
async function batchMarkSynced(entryIds: number[]) {
  return await prisma.timeEntry.updateMany({
    where: {
      id: { in: entryIds },
    },
    data: {
      synced: true,
      syncedAt: new Date(),
    },
  });
}

/**
 * EXAMPLE 6: Get Project with All Entries in Date Range
 * 
 * Fetch a project and all its time entries for a specific period.
 */
async function getProjectWithEntries(
  projectId: number,
  start: Date,
  end: Date,
) {
  return await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      timeEntries: {
        where: {
          begin: {
            gte: start,
            lt: end,
          },
        },
        orderBy: {
          begin: 'desc',
        },
      },
    },
  });
}

/**
 * EXAMPLE 7: Create/Update Project from Kimai
 * 
 * Idempotent upsert for projects with Notion database mapping.
 */
async function upsertProject(kimaiProject: any, notionDatabaseId?: string) {
  return await prisma.project.upsert({
    where: { kimaiId: kimaiProject.id },  // Unique Kimai ID
    update: {
      name: kimaiProject.name,
      description: kimaiProject.description || null,
      notionDatabaseId,
      lastSyncedAt: new Date(),
    },
    create: {
      kimaiId: kimaiProject.id,
      name: kimaiProject.name,
      description: kimaiProject.description || null,
      notionDatabaseId,
      isActive: true,
    },
  });
}

/**
 * EXAMPLE 8: Count Unsynced Entries
 * 
 * Get total count of entries waiting to be synced.
 */
async function countUnsynced() {
  return await prisma.timeEntry.count({
    where: {
      synced: false,
    },
  });
}

/**
 * EXAMPLE 9: Find Entry by Kimai ID
 * 
 * Quick lookup by the Kimai identifier.
 */
async function getEntryByKimaiId(kimaiId: number) {
  return await prisma.timeEntry.findUnique({
    where: { kimaiId },
    include: { project: true },
  });
}

/**
 * EXAMPLE 10: Delete Entries (Cascade)
 * 
 * When you delete a project, all its entries are automatically deleted
 * due to cascading delete constraint.
 */
async function deleteProject(projectId: number) {
  return await prisma.project.delete({
    where: { id: projectId },
    // All timeEntries with this projectId will be auto-deleted
  });
}

/**
 * EXAMPLE 11: Transaction - Atomic Operations
 * 
 * Ensure multiple operations succeed together or all fail.
 * Useful for sync operations that affect both entries and projects.
 */
async function syncEntriesAtomic(
  projectId: number,
  entries: any[],
  weekStart: Date,
  weekEnd: Date,
) {
  return await prisma.$transaction(async (tx) => {
    // Remove old entries for this period
    await tx.timeEntry.deleteMany({
      where: {
        projectId,
        begin: { gte: weekStart, lt: weekEnd },
      },
    });

    // Create fresh entries
    const created = await Promise.all(
      entries.map((entry) =>
        tx.timeEntry.create({
          data: {
            kimaiId: entry.id,
            projectId,
            activity: entry.activity,
            begin: new Date(entry.begin),
            end: entry.end ? new Date(entry.end) : null,
            duration: entry.duration || 0,
          },
        }),
      ),
    );

    // Update project sync time
    await tx.project.update({
      where: { id: projectId },
      data: { lastSyncedAt: new Date() },
    });

    return created;
  });
}

/**
 * EXAMPLE 12: Pagination
 * 
 * Fetch entries in chunks (useful for large sync operations).
 */
async function getEntriesPaginated(
  projectId: number,
  page: number = 1,
  pageSize: number = 100,
) {
  const skip = (page - 1) * pageSize;

  const [entries, total] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { projectId },
      skip,
      take: pageSize,
      orderBy: { begin: 'desc' },
    }),
    prisma.timeEntry.count({ where: { projectId } }),
  ]);

  return {
    entries,
    total,
    page,
    pages: Math.ceil(total / pageSize),
  };
}

/**
 * EXAMPLE 13: Full History Sync (Last 3 Years)
 * 
 * Gets all entries for a project from the last 3 years.
 */
async function getFullHistoryForProject(projectId: number) {
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);

  return await prisma.timeEntry.findMany({
    where: {
      projectId,
      begin: {
        gte: threeYearsAgo,
      },
    },
    orderBy: {
      begin: 'desc',
    },
  });
}

/**
 * EXAMPLE 14: Get Sync Statistics
 * 
 * Monitor sync progress and status.
 */
async function getSyncStats() {
  const [total, synced, unsynced, syncedRecently] = await Promise.all([
    prisma.timeEntry.count(),
    prisma.timeEntry.count({ where: { synced: true } }),
    prisma.timeEntry.count({ where: { synced: false } }),
    prisma.timeEntry.count({
      where: {
        synced: true,
        syncedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        },
      },
    }),
  ]);

  return {
    total,
    synced,
    unsynced,
    syncedRecently,
    syncProgress: total > 0 ? ((synced / total) * 100).toFixed(2) + '%' : 'N/A',
  };
}

// ============================================================================
// CLEANUP - Don't forget to disconnect
// ============================================================================

async function cleanup() {
  await prisma.$disconnect();
}
