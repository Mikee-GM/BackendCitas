import { PartialType } from '@nestjs/mapped-types';
import { CreateEmployeePhotoDto } from './create-employee-photo.dto';

export class UpdateEmployeePhotoDto extends PartialType(CreateEmployeePhotoDto) {}
