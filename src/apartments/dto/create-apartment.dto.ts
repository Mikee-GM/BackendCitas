import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateApartmentDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsString()
  @IsOptional()
  direccion?: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsNumber()
  @IsOptional()
  ubicacionLat?: number;

  @IsNumber()
  @IsOptional()
  ubicacionLng?: number;
}
