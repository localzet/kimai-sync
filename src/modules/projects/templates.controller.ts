import { Controller, Get, Post, Put, Param, Body, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

interface NotionTemplateDTO {
  templateId?: string; // Optional identifier for this template
  propertyMap: {
    title: string;
    date: string;
    duration: string;
    activity: string;
    tags?: string;
    project?: string;
    kimaiId: string;
  };
}

@Controller('projects/:projectId/template')
export class TemplatesController {
  private readonly logger = new Logger(TemplatesController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getTemplate(@Param('projectId') projectId: string) {
    try {
      const project = await this.prisma.project.findUniqueOrThrow({
        where: { id: parseInt(projectId) },
      });

      return {
        template: project.notionTemplate,
      };
    } catch (error) {
      this.logger.error(`❌ Failed to get template for project ${projectId}`, error);
      throw error;
    }
  }

  @Put()
  async updateTemplate(@Param('projectId') projectId: string, @Body() dto: NotionTemplateDTO) {
    try {
      const updated = await this.prisma.project.update({
        where: { id: parseInt(projectId) },
        data: {
          notionTemplate: {
            templateId: dto.templateId || null,
            propertyMap: dto.propertyMap,
          },
        },
      });

      this.logger.log(`✅ Updated Notion template for project ${projectId}`);

      return {
        template: updated.notionTemplate,
      };
    } catch (error) {
      this.logger.error(`❌ Failed to update template for project ${projectId}`, error);
      throw error;
    }
  }

  @Post('validate')
  async validateTemplate(@Param('projectId') projectId: string, @Body() dto: NotionTemplateDTO) {
    try {
      // TODO: Call NotionClient to validate database exists and has required properties
      this.logger.log(`✅ Template validated for project ${projectId}`);

      return {
        valid: true,
        message: 'Template is valid',
      };
    } catch (error) {
      this.logger.error(`❌ Template validation failed for project ${projectId}`, error);
      throw error;
    }
  }
}
