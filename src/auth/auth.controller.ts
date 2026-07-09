import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import {
  ApiControllerDocs,
  ApiLoginDocs,
} from '../common/swagger/api-docs.decorators';

@Controller('auth')
@ApiControllerDocs('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiLoginDocs(LoginDto)
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }
}
