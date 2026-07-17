import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    description: 'Correo del usuario registrado',
    example: 'admin@example.com',
  })
  email: string;

  @ApiPropertyOptional({
    description: 'Contrasena del usuario',
    example: 'secret123',
    minLength: 6,
  })
  password?: string;
}
