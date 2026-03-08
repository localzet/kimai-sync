import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { KimaiService } from './kimai.service';
import { KimaiClient } from './kimai.client';

@Module({
  imports: [HttpModule],
  providers: [KimaiService, KimaiClient],
  exports: [KimaiService],
})
export class KimaiModule {}
