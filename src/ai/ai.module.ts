import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiProviderService } from './ai-provider.service';

@Module({
  imports: [ConfigModule],
  providers: [AiProviderService],
  exports: [AiProviderService],
})
export class AiModule {}
