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
import { Servicios } from './entities/service.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  ApiActionDocs,
  ApiControllerDocs,
  ApiCreateDocs,
  ApiFindAllDocs,
  ApiFindOneDocs,
  ApiRemoveDocs,
  ApiUpdateDocs,
} from '../common/swagger/api-docs.decorators';

@Controller('services')
@ApiControllerDocs('services', true)
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'jefe')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post()
  @ApiCreateDocs({
    tag: 'services',
    entity: Servicios,
    createDto: CreateServiceDto,
    protected: true,
  })
  create(@Body() createServiceDto: CreateServiceDto) {
    return this.servicesService.create(createServiceDto);
  }

  @Get('pendientes')
  @ApiFindAllDocs({
    tag: 'services pendientes',
    entity: Servicios,
    protected: true,
  })
  getPending() {
    return this.servicesService.getPending();
  }

  @Get()
  @ApiFindAllDocs({ tag: 'services', entity: Servicios, protected: true })
  findAll() {
    return this.servicesService.findAll();
  }

  @Get(':id')
  @ApiFindOneDocs({ tag: 'services', entity: Servicios, protected: true })
  findOne(@Param('id') id: string) {
    return this.servicesService.findOne(id);
  }

  @Patch(':id')
  @ApiUpdateDocs({
    tag: 'services',
    entity: Servicios,
    updateDto: UpdateServiceDto,
    protected: true,
  })
  update(@Param('id') id: string, @Body() updateServiceDto: UpdateServiceDto) {
    return this.servicesService.update(id, updateServiceDto);
  }

  @Delete(':id')
  @ApiRemoveDocs({ tag: 'services', protected: true })
  remove(@Param('id') id: string) {
    return this.servicesService.remove(id);
  }

  @Post(':id/aceptar')
  @ApiActionDocs('Aceptar un servicio pendiente', true, 'ID del servicio')
  aceptar(@Param('id') id: string, @Req() req: any) {
    const jefeId = req.user.id;
    return this.servicesService.aceptar(id, jefeId);
  }

  @Post(':id/rechazar')
  @ApiActionDocs('Rechazar un servicio pendiente', true, 'ID del servicio')
  rechazar(@Param('id') id: string, @Req() req: any) {
    const jefeId = req.user.id;
    return this.servicesService.rechazar(id, jefeId);
  }
}
