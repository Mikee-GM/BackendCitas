import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@Controller()
@ApiTags('health')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Obtener mensaje de estado de la API' })
  @ApiOkResponse({ description: 'Mensaje de estado', type: String })
  getHello(): string {
    return this.appService.getHello();
  }
}
