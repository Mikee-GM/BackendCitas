import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { EmployeePhotosService } from './employee-photos.service';
import { CreateEmployeePhotoDto } from './dto/create-employee-photo.dto';
import { UpdateEmployeePhotoDto } from './dto/update-employee-photo.dto';

@Controller('employee-photos')
export class EmployeePhotosController {
  constructor(private readonly employeePhotosService: EmployeePhotosService) {}

  @Post()
  create(@Body() createEmployeePhotoDto: CreateEmployeePhotoDto) {
    return this.employeePhotosService.create(createEmployeePhotoDto);
  }

  @Get()
  findAll() {
    return this.employeePhotosService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.employeePhotosService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateEmployeePhotoDto: UpdateEmployeePhotoDto) {
    return this.employeePhotosService.update(+id, updateEmployeePhotoDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.employeePhotosService.remove(+id);
  }
}
