import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ClientAlertsService } from './client-alerts.service';
import { CreateClientAlertDto } from './dto/create-client-alert.dto';
import { UpdateClientAlertDto } from './dto/update-client-alert.dto';

@Controller('client-alerts')
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
  update(@Param('id') id: string, @Body() updateClientAlertDto: UpdateClientAlertDto) {
    return this.clientAlertsService.update(+id, updateClientAlertDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.clientAlertsService.remove(+id);
  }
}
