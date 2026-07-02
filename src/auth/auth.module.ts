import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Usuarios } from '../users/entities/user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([Usuarios]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret:
        process.env.JWT_SECRET ||
        'super_secret_key_change_me_in_production_123456',
      signOptions: {
        expiresIn: (process.env.JWT_EXPIRATION || '24h') as '24h',
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtStrategy, PassportModule, JwtModule],
})
export class AuthModule {}
