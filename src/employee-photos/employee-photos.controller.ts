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
import { EmployeePhotosService } from './employee-photos.service';
import { CreateEmployeePhotoDto } from './dto/create-employee-photo.dto';
import { UpdateEmployeePhotoDto } from './dto/update-employee-photo.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('employee-photos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmployeePhotosController {
  constructor(private readonly employeePhotosService: EmployeePhotosService) {}

  @Post()
  @Roles('admin', 'jefe')
  create(@Body() createEmployeePhotoDto: CreateEmployeePhotoDto) {
    return this.employeePhotosService.create(createEmployeePhotoDto);
  }

  @Get()
  @Roles('admin', 'jefe', 'empleada')
  findAll() {
    return this.employeePhotosService.findAll();
  }

  @Get(':id')
  @Roles('admin', 'jefe', 'empleada')
  findOne(@Param('id') id: string) {
    return this.employeePhotosService.findOne(id);
  }

  @Patch(':id')
  @Roles('admin', 'jefe')
  update(
    @Param('id') id: string,
    @Body() updateEmployeePhotoDto: UpdateEmployeePhotoDto,
  ) {
    return this.employeePhotosService.update(id, updateEmployeePhotoDto);
  }

  @Delete(':id')
  @Roles('admin', 'jefe')
  remove(@Param('id') id: string) {
    return this.employeePhotosService.remove(id);
  }
}
