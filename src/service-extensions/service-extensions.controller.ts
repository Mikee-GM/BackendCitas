import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ServiceExtensionsService } from './service-extensions.service';
import { CreateServiceExtensionDto } from './dto/create-service-extension.dto';
import { UpdateServiceExtensionDto } from './dto/update-service-extension.dto';

@Controller('service-extensions')
export class ServiceExtensionsController {
  constructor(private readonly serviceExtensionsService: ServiceExtensionsService) {}

  @Post()
  create(@Body() createServiceExtensionDto: CreateServiceExtensionDto) {
    return this.serviceExtensionsService.create(createServiceExtensionDto);
  }

  @Get()
  findAll() {
    return this.serviceExtensionsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.serviceExtensionsService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateServiceExtensionDto: UpdateServiceExtensionDto) {
    return this.serviceExtensionsService.update(+id, updateServiceExtensionDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.serviceExtensionsService.remove(+id);
  }
}
