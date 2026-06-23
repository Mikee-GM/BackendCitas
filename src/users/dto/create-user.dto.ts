import {
  IsEmail,
  IsString,
  IsEnum,
  IsBoolean,
  IsOptional,
  MinLength,
  MaxLength,
} from 'class-validator';

export class CreateUserDto {
  @IsEmail({}, { message: 'El correo electrónico debe ser válido' })
  @MaxLength(255, {
    message: 'El correo electrónico no puede superar los 255 caracteres',
  })
  readonly email: string;

  @IsString({ message: 'La contraseña debe ser una cadena de texto' })
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  readonly password: string;

  @IsEnum(['jefe', 'empleada', 'chofer', 'admin'], {
    message:
      'El rol debe ser uno de los siguientes: jefe, empleada, chofer, admin',
  })
  readonly rol: 'jefe' | 'empleada' | 'chofer' | 'admin';

  @IsBoolean({ message: 'El estado activo debe ser un valor booleano' })
  @IsOptional()
  readonly activo?: boolean;

  @IsString({
    message: 'El ID de chat de Telegram debe ser una cadena de texto',
  })
  @IsOptional()
  readonly telegramChatId?: string;
}
