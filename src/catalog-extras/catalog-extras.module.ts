import { Module } from '@nestjs/common';
import { CatalogExtrasService } from './catalog-extras.service';
import { CatalogExtrasController } from './catalog-extras.controller';

@Module({
  controllers: [CatalogExtrasController],
  providers: [CatalogExtrasService],
})
export class CatalogExtrasModule {}
