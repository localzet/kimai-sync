import { Controller, Get, Post, Body, Param, Delete, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

interface ProjectDTO {
  id?: number;
  name: string;
  kimaiId: number;
}

interface ProjectResponse {
  id: number;
  name: string;
  kimaiId: number;
  synced: number;
  total: number;
}

@Controller('projects')
export class ProjectsController {
  private readonly logger = new Logger(ProjectsController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getProjects(): Promise<ProjectResponse[]> {
    try {
      const projects = await this.prisma.project.findMany({
        include: {
          _count: {
            select: {
              timeEntries: true,
            },
          },
        },
      });

      return Promise.all(
        projects.map(async (project: any) => {
          const synced = await this.prisma.timeEntry.count({
            where: {
              projectId: project.id,
              synced: true,
            },
          });

          return {
            id: project.id,
            name: project.name,
            kimaiId: project.kimaiId,
            synced,
            total: project._count.timeEntries,
          };
        }),
      );
    } catch (error) {
      this.logger.error('❌ Failed to get projects', error);
      throw error;
    }
  }

  @Get(':id')
  async getProject(@Param('id') id: string): Promise<ProjectResponse> {
    try {
      const project = await this.prisma.project.findUniqueOrThrow({
        where: { id: parseInt(id) },
        include: {
          _count: {
            select: {
              timeEntries: true,
            },
          },
        },
      });

      const synced = await this.prisma.timeEntry.count({
        where: {
          projectId: project.id,
          synced: true,
        },
      });

      return {
        id: project.id,
        name: project.name,
        kimaiId: project.kimaiId,
        synced,
        total: project._count.timeEntries,
      };
    } catch (error) {
      this.logger.error('❌ Failed to get project', error);
      throw error;
    }
  }

  @Post()
  async createProject(@Body() dto: ProjectDTO) {
    try {
      return await this.prisma.project.create({
        data: {
          name: dto.name,
          kimaiId: dto.kimaiId,
        },
      });
    } catch (error) {
      this.logger.error('❌ Failed to create project', error);
      throw error;
    }
  }

  @Delete(':id')
  async deleteProject(@Param('id') id: string) {
    try {
      return await this.prisma.project.delete({
        where: { id: parseInt(id) },
      });
    } catch (error) {
      this.logger.error('❌ Failed to delete project', error);
      throw error;
    }
  }
}
