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
import { ClientAlertsService } from './client-alerts.service';
import { CreateClientAlertDto } from './dto/create-client-alert.dto';
import { UpdateClientAlertDto } from './dto/update-client-alert.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('client-alerts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'jefe')
export class ClientAlertsController {
  constructor(private readonly clientAlertsService: ClientAlertsService) {}

  @Post()
  create(@Body() createClientAlertDto: CreateClientAlertDto) {
    return this.clientAlertsService.create(createClientAlertDto);
  }

  @Get()
  findAll() {
    return this.clientAlertsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.clientAlertsService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateClientAlertDto: UpdateClientAlertDto,
  ) {
    return this.clientAlertsService.update(+id, updateClientAlertDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.clientAlertsService.remove(+id);
  }
}
