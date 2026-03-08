import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { appConfig } from '@config/app.config';
import { databaseConfig } from '@config/database.config';
import { kimaiConfig } from '@config/kimai.config';
import { notionConfig } from '@config/notion.config';
import { redisConfig } from '@config/redis.config';
import { syncConfig } from '@config/sync.config';
import { DatabaseModule } from '@modules/database/database.module';
import { KimaiModule } from '@modules/kimai/kimai.module';
import { NotionModule } from '@modules/notion/notion.module';
import { SyncModule } from '@modules/sync/sync.module';
import { JobsModule } from '@modules/jobs/jobs.module';
import { ProjectsModule } from '@modules/projects/projects.module';
import { AppConfigModule } from '@modules/config/config.module';
import { HealthController } from './health.controller';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            load: [appConfig, databaseConfig, kimaiConfig, notionConfig, redisConfig, syncConfig],
        }),
        BullModule.forRoot({
            redis: process.env.REDIS_URL || 'redis://localhost:6379',
        }),

        DatabaseModule,
        KimaiModule,
        NotionModule,
        SyncModule,
        JobsModule,
        ProjectsModule,
        AppConfigModule,
    ],
    controllers: [HealthController],
})
export class AppModule { }
