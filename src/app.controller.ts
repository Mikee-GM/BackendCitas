import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { EmployeesService } from './employees/employees.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly employeesService: EmployeesService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('catalog/employees')
  async getCatalogEmployees() {
    return this.employeesService.findAllActive();
  }
}
