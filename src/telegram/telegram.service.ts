import { Injectable } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf, Context, Markup } from 'telegraf';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usuarios } from '../users/entities/user.entity';
import { Servicios } from '../services/entities/service.entity';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class TelegramService {
  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    @InjectRepository(Usuarios)
    private readonly usuariosRepository: Repository<Usuarios>,
    @InjectRepository(Servicios)
    private readonly serviciosRepository: Repository<Servicios>,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Envia un mensaje programático a un usuario por su ID de Telegram.
   * @param telegramId El ID de Telegram del usuario (como string bigint).
   * @param message El mensaje a enviar.
   */
  async sendMessage(telegramId: string, message: string): Promise<void> {
    await this.bot.telegram.sendMessage(telegramId, message);
  }

  /**
   * Notifica a todos los Jefes y Admins de un nuevo servicio creado.
   */
  async notifyJefesNewService(serviceId: string): Promise<void> {
    // Las notificaciones para jefes e independientes ahora se manejan exclusivamente a través de los temas (forum topics) en sus grupos de Telegram
  }
}
