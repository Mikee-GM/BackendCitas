import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ServiceExtrasService } from './service-extras.service';
import { CreateServiceExtraDto } from './dto/create-service-extra.dto';
import { UpdateServiceExtraDto } from './dto/update-service-extra.dto';

@Controller('service-extras')
export class ServiceExtrasController {
  constructor(private readonly serviceExtrasService: ServiceExtrasService) {}

  @Post()
  create(@Body() createServiceExtraDto: CreateServiceExtraDto) {
    return this.serviceExtrasService.create(createServiceExtraDto);
  }

  @Get()
  findAll() {
    return this.serviceExtrasService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.serviceExtrasService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateServiceExtraDto: UpdateServiceExtraDto) {
    return this.serviceExtrasService.update(+id, updateServiceExtraDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.serviceExtrasService.remove(+id);
  }
}
