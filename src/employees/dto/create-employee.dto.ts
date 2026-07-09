import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsBoolean,
  IsOptional,
  IsEmail,
  MinLength,
  IsNumber,
  IsArray,
  IsEnum,
} from 'class-validator';

export class CreateEmployeeDto {
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

  @IsString({ message: 'El nombre real debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El nombre real es obligatorio' })
  @MaxLength(255, {
    message: 'El nombre real no puede superar los 255 caracteres',
  })
  readonly nombreReal: string;

  @IsString({ message: 'El nombre artístico debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El nombre artístico es obligatorio' })
  @MaxLength(255, {
    message: 'El nombre artístico no puede superar los 255 caracteres',
  })
  readonly nombreArtistico: string;

  @IsString({ message: 'El slug del catálogo debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El slug del catálogo es obligatorio' })
  @MaxLength(100, {
    message: 'El slug del catálogo no puede superar los 100 caracteres',
  })
  readonly slugCatalogo: string;

  @IsString({
    message: 'La URL de la foto de perfil debe ser una cadena de texto',
  })
  @IsOptional()
  readonly fotoPerfilUrl?: string;

  @IsString({ message: 'La descripción debe ser una cadena de texto' })
  @IsOptional()
  readonly descripcion?: string;

  @IsNumber(
    {},
    { message: 'El precio base por hora debe ser un número válido' },
  )
  @IsNotEmpty({ message: 'El precio base por hora es obligatorio' })
  readonly precioBaseHora: number;

  @IsBoolean({ message: 'El estado disponible debe ser un valor booleano' })
  @IsOptional()
  readonly disponible?: boolean;

  @IsBoolean({
    message: 'El estado del catálogo activo debe ser un valor booleano',
  })
  @IsOptional()
  readonly catalogoActivo?: boolean;

  @IsString({ message: 'La latitud debe ser una cadena de texto' })
  @IsOptional()
  readonly ubicacionLat?: string;

  @IsString({ message: 'La longitud debe ser una cadena de texto' })
  @IsOptional()
  readonly ubicacionLng?: string;

  @IsString({ message: 'El ID del jefe debe ser una cadena de texto' })
  @IsOptional()
  readonly jefeId?: string;

  @IsString({ message: 'El enlace de X debe ser una cadena de texto' })
  @IsOptional()
  readonly linkX?: string;

  @IsString({ message: 'La etiqueta de contacto debe ser una cadena de texto' })
  @IsOptional()
  readonly contactLabel?: string;

  @IsArray({ message: 'Las fotos extras deben proporcionarse como un arreglo' })
  @IsString({
    each: true,
    message: 'Cada foto extra debe ser una cadena de texto con la URL',
  })
  @IsOptional()
  readonly fotosExtra?: string[];

  @IsEnum(['independiente', 'agencia'], {
    message: 'El tipo de empleada debe ser independiente o agencia',
  })
  @IsNotEmpty({ message: 'El tipo de empleada es obligatorio' })
  readonly tipo: 'independiente' | 'agencia';
}
