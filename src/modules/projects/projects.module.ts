import { Module } from '@nestjs/common';
import { DatabaseModule } from '@modules/database/database.module';
import { ProjectsController } from './projects.controller';
import { TemplatesController } from './templates.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [ProjectsController, TemplatesController],
})
export class ProjectsModule {}
