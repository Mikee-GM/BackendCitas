import {
  Controller,
  Get,
  Sse,
  Query,
  Res,
  UnauthorizedException,
  Headers,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Observable } from 'rxjs';
import { RealtimeEventsService } from './realtime.service';
import { Empleadas } from '../employees/entities/employee.entity';
import { Choferes } from '../drivers/entities/driver.entity';
import {
  ApiControllerDocs,
  ApiSseTokenDocs,
} from '../common/swagger/api-docs.decorators';

@Controller('realtime')
@ApiControllerDocs('realtime')
export class RealtimeController {
  constructor(
    private readonly realtimeEventsService: RealtimeEventsService,
    private readonly jwtService: JwtService,
    @InjectRepository(Empleadas)
    private readonly empleadasRepository: Repository<Empleadas>,
    @InjectRepository(Choferes)
    private readonly choferesRepository: Repository<Choferes>,
  ) {}

  private verifyToken(token: string): any {
    try {
      return this.jwtService.verify(token);
    } catch (e) {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }

  @Sse('sse/jefes')
  @ApiSseTokenDocs('Conectar canal SSE para panel de jefes')
  sseJefes(@Query('token') token: string): Observable<any> {
    const payload = this.verifyToken(token);
    if (payload.rol !== 'jefe' && payload.rol !== 'admin') {
      throw new UnauthorizedException('No tienes permisos para este panel');
    }
    return this.realtimeEventsService.getJefesStream();
  }

  @Sse('sse/empleada')
  @ApiSseTokenDocs('Conectar canal SSE para empleada autenticada')
  async sseEmpleada(@Query('token') token: string): Promise<Observable<any>> {
    const payload = this.verifyToken(token);
    if (payload.rol !== 'empleada') {
      throw new UnauthorizedException('Solo empleadas pueden conectar aquí');
    }
    const empleada = await this.empleadasRepository.findOne({
      where: { usuarioId: payload.sub },
    });
    if (!empleada) {
      throw new UnauthorizedException('Perfil de empleada no encontrado');
    }
    return this.realtimeEventsService.getEmployeeStream(empleada.id);
  }

  @Sse('sse/chofer')
  @ApiSseTokenDocs('Conectar canal SSE para chofer autenticado')
  async sseChofer(@Query('token') token: string): Promise<Observable<any>> {
    const payload = this.verifyToken(token);
    if (payload.rol !== 'chofer') {
      throw new UnauthorizedException('Solo choferes pueden conectar aquí');
    }
    const chofer = await this.choferesRepository.findOne({
      where: { usuarioId: payload.sub },
    });
    if (!chofer) {
      throw new UnauthorizedException('Perfil de chofer no encontrado');
    }
    return this.realtimeEventsService.getDriverStream(chofer.id);
  }
}
