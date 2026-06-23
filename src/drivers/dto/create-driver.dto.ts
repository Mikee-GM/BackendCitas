import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsBoolean,
  IsOptional,
  IsEmail,
  MinLength,
} from 'class-validator';

export class CreateDriverDto {
  @IsEmail({}, { message: 'El correo electrónico debe ser válido' })
  @IsNotEmpty({ message: 'El correo electrónico es obligatorio' })
  @MaxLength(255, {
    message: 'El correo electrónico no puede superar los 255 caracteres',
  })
  readonly email: string;

  @IsString({ message: 'La contraseña debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  readonly password: string;

  @IsString({
    message: 'El ID de chat de Telegram debe ser una cadena de texto',
  })
  @IsOptional()
  readonly telegramChatId?: string;

  @IsString({ message: 'El nombre debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(255, { message: 'El nombre no puede superar los 255 caracteres' })
  readonly nombre: string;

  @IsString({ message: 'El teléfono debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El teléfono es obligatorio' })
  @MaxLength(30, { message: 'El teléfono no puede superar los 30 caracteres' })
  readonly telefono: string;

  @IsBoolean({ message: 'El estado disponible debe ser un valor booleano' })
  @IsOptional()
  readonly disponible?: boolean;

  @IsString({ message: 'La latitud debe ser una cadena de texto' })
  @IsOptional()
  readonly ubicacionLat?: string;

  @IsString({ message: 'La longitud debe ser una cadena de texto' })
  @IsOptional()
  readonly ubicacionLng?: string;
}
