import { Injectable } from '@nestjs/common';
import { CreateEmployeePhotoDto } from './dto/create-employee-photo.dto';
import { UpdateEmployeePhotoDto } from './dto/update-employee-photo.dto';

@Injectable()
export class EmployeePhotosService {
  create(createEmployeePhotoDto: CreateEmployeePhotoDto) {
    return 'This action adds a new employeePhoto';
  }

  findAll() {
    return `This action returns all employeePhotos`;
  }

  findOne(id: number) {
    return `This action returns a #${id} employeePhoto`;
  }

  update(id: number, updateEmployeePhotoDto: UpdateEmployeePhotoDto) {
    return `This action updates a #${id} employeePhoto`;
  }

  remove(id: number) {
    return `This action removes a #${id} employeePhoto`;
  }
}
