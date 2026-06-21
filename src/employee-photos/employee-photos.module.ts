import { Module } from '@nestjs/common';
import { EmployeePhotosService } from './employee-photos.service';
import { EmployeePhotosController } from './employee-photos.controller';

@Module({
  controllers: [EmployeePhotosController],
  providers: [EmployeePhotosService],
})
export class EmployeePhotosModule {}
