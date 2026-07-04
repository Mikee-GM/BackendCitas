import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('services')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'jefe')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post()
  create(@Body() createServiceDto: CreateServiceDto) {
    return this.servicesService.create(createServiceDto);
  }

  @Get('pendientes')
  getPending() {
    return this.servicesService.getPending();
  }

  @Get()
  findAll() {
    return this.servicesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.servicesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateServiceDto: UpdateServiceDto) {
    return this.servicesService.update(id, updateServiceDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.servicesService.remove(id);
  }

  @Post(':id/aceptar')
  aceptar(@Param('id') id: string, @Req() req: any) {
    const jefeId = req.user.id;
    return this.servicesService.aceptar(id, jefeId);
  }

  @Post(':id/rechazar')
  rechazar(@Param('id') id: string, @Req() req: any) {
    const jefeId = req.user.id;
    return this.servicesService.rechazar(id, jefeId);
  }
}
