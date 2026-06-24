import {
  IsUUID,
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
} from 'class-validator';

export class CreateEmployeePhotoDto {
  @IsUUID('4', { message: 'El ID de la empleada debe ser un UUID v4 válido' })
  @IsNotEmpty({ message: 'El ID de la empleada es obligatorio' })
  readonly empleadaId: string;

  @IsString({ message: 'La URL debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'La URL es obligatoria' })
  readonly url: string;

  @IsNumber({}, { message: 'El orden debe ser un número válido' })
  @IsOptional()
  readonly orden?: number;
}
