import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { Usuarios } from '../../users/entities/user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectRepository(Usuarios)
    private readonly usuariosRepository: Repository<Usuarios>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        process.env.JWT_SECRET ||
        'super_secret_key_change_me_in_production_123456',
    });
  }

  async validate(payload: { sub: string; email: string }) {
    const user = await this.usuariosRepository.findOne({
      where: { id: payload.sub, activo: true },
    });
    if (!user) {
      throw new UnauthorizedException('Usuario no válido o inactivo');
    }
    return user;
  }
}
