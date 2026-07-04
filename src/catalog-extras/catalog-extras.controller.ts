import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { CatalogExtrasService } from './catalog-extras.service';
import { CreateCatalogExtraDto } from './dto/create-catalog-extra.dto';
import { UpdateCatalogExtraDto } from './dto/update-catalog-extra.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('catalog-extras')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CatalogExtrasController {
  constructor(private readonly catalogExtrasService: CatalogExtrasService) {}

  @Post()
  @Roles('admin', 'jefe')
  create(@Body() createCatalogExtraDto: CreateCatalogExtraDto) {
    return this.catalogExtrasService.create(createCatalogExtraDto);
  }

  @Get()
  @Roles('admin', 'jefe', 'empleada')
  findAll() {
    return this.catalogExtrasService.findAll();
  }

  @Get(':id')
  @Roles('admin', 'jefe', 'empleada')
  findOne(@Param('id') id: string) {
    return this.catalogExtrasService.findOne(+id);
  }

  @Patch(':id')
  @Roles('admin', 'jefe')
  update(
    @Param('id') id: string,
    @Body() updateCatalogExtraDto: UpdateCatalogExtraDto,
  ) {
    return this.catalogExtrasService.update(+id, updateCatalogExtraDto);
  }

  @Delete(':id')
  @Roles('admin', 'jefe')
  remove(@Param('id') id: string) {
    return this.catalogExtrasService.remove(+id);
  }
}
