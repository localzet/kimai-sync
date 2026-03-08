# Kimai Sync - Time Tracking Data Synchronization

A NestJS-based application that synchronizes time tracking data from Kimai to PostgreSQL and Notion with project-specific templates.

## Features

- **Bi-directional Sync**: Synchronize Kimai time entries to PostgreSQL and Notion
- **Scheduled Sync**: Automatic sync of current week data every 5 minutes
- **Full History Sync**: On-demand sync of last 3 years of Kimai data
- **Job Queue Management**: BullMQ-powered job processing with automatic retries
- **RESTful API**: Endpoints to trigger manual sync operations
- **Docker Support**: Complete Docker and Docker Compose setup
- **Prisma ORM**: Type-safe database access with migrations

## Tech Stack

- **NestJS 10.x** - Node.js framework for scalable applications
- **Prisma** - Type-safe ORM with migrations
- **BullMQ** - Redis-backed job queue
- **node-cron** - Task scheduling
- **Axios** - HTTP client for API calls
- **PostgreSQL** - Primary database
- **Redis** - Job queue and caching backend
- **Docker** - Containerization and orchestration

## Prerequisites

- Node.js 20+ or Docker
- npm or yarn
- PostgreSQL 14+ (or use Docker Compose)
- Redis 7+ (or use Docker Compose)

## Project Structure

```
src/
├── modules/
│   ├── kimai/              # Kimai API client
│   ├── sync/               # Core sync orchestration
│   ├── jobs/               # BullMQ job handlers
│   ├── notion/             # Notion API integration
│   └── database/           # Prisma integration
├── config/
│   ├── kimai.config.ts
│   ├── notion.config.ts
│   └── database.config.ts
├── types/                  # TypeScript interfaces
└── app.module.ts
```

## Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd kimai-sync
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Update the following variables:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=kimai_user
DB_PASSWORD=your_password
DB_NAME=kimai_sync

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# Kimai
KIMAI_URL=https://your-kimai-instance.com
KIMAI_API_KEY=your_api_key

# Notion
NOTION_API_KEY=your_notion_api_key
NOTION_DATABASE_ID=your_database_id

# Sync
SYNC_INTERVAL=5  # minutes
```

## Running the Application

### Local Development

#### Prerequisites

Ensure PostgreSQL and Redis are running on your local machine or use Docker:

```bash
# Start PostgreSQL and Redis using Docker
docker-compose up -d postgres redis
```

#### Setup Database

```bash
# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate
```

#### Start Application

```bash
# Development mode with watch
npm run start:dev

# Production mode
npm run build
npm start
```

The application will start on `http://localhost:3000`

### Docker Compose (Recommended)

Complete setup with PostgreSQL, Redis, and the application:

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop services
docker-compose down
```

The application will be available at `http://localhost:3000`

### Environment-Specific Setup

**Development:**
```bash
NODE_ENV=development npm run start:dev
```

**Production:**
```bash
NODE_ENV=production npm run build && npm start
```

## API Endpoints

### Health Check

```bash
GET /health
```

Returns application health status.

### Manual Sync Triggers

#### Full History Sync (Last 3 Years)

```bash
POST /sync/full
```

Response:
```json
{
  "jobId": "123",
  "status": "queued"
}
```

#### Current Week Sync

```bash
POST /sync/weekly
```

Response:
```json
{
  "jobId": "124",
  "status": "queued"
}
```

## Database Migrations

### Create Migration

```bash
npm run prisma:migrate -- --name migration_name
```

### Apply Migrations

```bash
# Development
npm run prisma:migrate

# Production
npm run prisma:migrate:prod
```

### View Database (Prisma Studio)

```bash
npm run prisma:studio
```

Opens interactive database viewer at `http://localhost:5555`

## Testing

### Run Tests

```bash
# All tests
npm test

# Watch mode
npm test:watch

# Coverage report
npm test:cov

# End-to-end tests
npm run test:e2e
```

### Test Structure

Tests should follow:
- Unit tests: `*.spec.ts` alongside source files
- E2E tests: `test/` directory
- Coverage: `coverage/` directory (generated)

## Code Quality

### Format Code

```bash
npm run format
```

### Lint Code

```bash
npm run lint
```

## Scheduled Sync

The application automatically triggers weekly sync every 5 minutes via `node-cron`.

**Schedule:** `*/5 * * * *` (Every 5 minutes)

Configure via `SYNC_INTERVAL` environment variable.

## Job Queue Management

Jobs are processed by BullMQ with Redis backend:

- **Retry Policy**: 3 automatic retries with exponential backoff
- **Timeout**: 5 minutes per job
- **Concurrency**: 3 concurrent jobs
- **Cleanup**: Completed jobs removed after 1 hour

## Logging

Application logs are sent to stdout with configurable levels:

```env
LOG_LEVEL=log  # Options: log, error, warn, debug, verbose
```

## Performance Considerations

### Database Optimization

- Indexes on frequently queried fields
- Connection pooling via Prisma
- Batch upsert operations

### API Optimization

- Pagination for Kimai API calls
- Request timeout configuration
- Retry with exponential backoff

### Queue Optimization

- Batch job processing
- Job prioritization
- Dead-letter queue handling

## Troubleshooting

### Database Connection Issues

```bash
# Check PostgreSQL
docker-compose logs postgres

# Verify connection string
echo $DATABASE_URL
```

### Redis Connection Issues

```bash
# Check Redis
docker-compose logs redis

# Test connection
redis-cli -h localhost -p 6379 -a your_password ping
```

### Job Processing Issues

```bash
# Check BullMQ dashboard (if configured)
# Or review application logs
docker-compose logs -f app
```

### Notion API Errors

- Verify `NOTION_API_KEY` is correct
- Confirm `NOTION_DATABASE_ID` is valid
- Check API key has proper permissions

### Kimai API Errors

- Verify `KIMAI_API_KEY` and `KIMAI_URL` are correct
- Check Kimai instance is accessible
- Confirm API key has necessary scopes

## Development Workflow

### IDE Setup (VS Code)

1. Install NestJS extension
2. Install TypeScript support
3. Configure debugger in `.vscode/launch.json`

### Debugging

```bash
npm run start:debug
```

Then attach your debugger to port 9229.

### Contributing

1. Create feature branch: `git checkout -b feature/your-feature`
2. Commit changes: `git commit -am 'Add feature'`
3. Push branch: `git push origin feature/your-feature`
4. Create Pull Request

## Environment Variables Reference

See `.env.example` for complete list with descriptions.

Key variables:
- `NODE_ENV`: Application environment
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `KIMAI_URL`, `KIMAI_API_KEY`: Kimai API credentials
- `NOTION_API_KEY`, `NOTION_DATABASE_ID`: Notion configuration
- `SYNC_INTERVAL`: Scheduled sync interval in minutes

## License

MIT

## Support

For issues and questions:
1. Check existing GitHub issues
2. Create detailed bug report with logs
3. Enable debug logging: `LOG_LEVEL=debug`
