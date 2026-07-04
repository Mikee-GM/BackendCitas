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
import { ServiceExtrasService } from './service-extras.service';
import { CreateServiceExtraDto } from './dto/create-service-extra.dto';
import { UpdateServiceExtraDto } from './dto/update-service-extra.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('service-extras')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ServiceExtrasController {
  constructor(private readonly serviceExtrasService: ServiceExtrasService) {}

  @Post()
  @Roles('admin', 'jefe', 'empleada')
  create(@Body() createServiceExtraDto: CreateServiceExtraDto) {
    return this.serviceExtrasService.create(createServiceExtraDto);
  }

  @Get()
  @Roles('admin', 'jefe')
  findAll() {
    return this.serviceExtrasService.findAll();
  }

  @Get(':id')
  @Roles('admin', 'jefe')
  findOne(@Param('id') id: string) {
    return this.serviceExtrasService.findOne(+id);
  }

  @Patch(':id')
  @Roles('admin', 'jefe')
  update(
    @Param('id') id: string,
    @Body() updateServiceExtraDto: UpdateServiceExtraDto,
  ) {
    return this.serviceExtrasService.update(+id, updateServiceExtraDto);
  }

  @Delete(':id')
  @Roles('admin', 'jefe')
  remove(@Param('id') id: string) {
    return this.serviceExtrasService.remove(+id);
  }
}
