import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { CatalogExtrasService } from './catalog-extras.service';
import { CreateCatalogExtraDto } from './dto/create-catalog-extra.dto';
import { UpdateCatalogExtraDto } from './dto/update-catalog-extra.dto';

@Controller('catalog-extras')
export class CatalogExtrasController {
  constructor(private readonly catalogExtrasService: CatalogExtrasService) {}

  @Post()
  create(@Body() createCatalogExtraDto: CreateCatalogExtraDto) {
    return this.catalogExtrasService.create(createCatalogExtraDto);
  }

  @Get()
  findAll() {
    return this.catalogExtrasService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.catalogExtrasService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateCatalogExtraDto: UpdateCatalogExtraDto) {
    return this.catalogExtrasService.update(+id, updateCatalogExtraDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.catalogExtrasService.remove(+id);
  }
}
