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
    const serviceWithRelations = await this.serviciosRepository.findOne({
      where: { id: serviceId },
      relations: {
        cliente: true,
        empleada: {
          usuario: true,
        },
      },
    });

    if (!serviceWithRelations) return;

    try {
      // Si la empleada es independiente, la notificación le llega directamente a ella
      if (
        serviceWithRelations.empleada &&
        serviceWithRelations.empleada.tipo === 'independiente'
      ) {
        const empUser = serviceWithRelations.empleada.usuario;
        if (
          empUser &&
          empUser.telegramChatId &&
          empUser.telegramChatId !== '111111111'
        ) {
          const messageText =
            `🔔 *¡Nueva Solicitud de Servicio!* 🔔\n\n` +
            `• *Cliente:* ${serviceWithRelations.cliente?.nombreTelegram || 'Desconocido'}\n` +
            `• *Duración:* ${serviceWithRelations.duracionPactadaHoras} horas\n` +
            `• *Método de Pago:* ${serviceWithRelations.metodoPago.toUpperCase()}\n` +
            `• *Total:* $${serviceWithRelations.totalFinal || '0.00'}\n\n` +
            `¿Deseas aceptar o rechazar este servicio?`;

          try {
            await this.bot.telegram.sendMessage(
              empUser.telegramChatId,
              messageText,
              {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                  [
                    Markup.button.callback(
                      '🟢 Aceptar',
                      `jefe_autorizar:${serviceWithRelations.id}:1`,
                    ),
                    Markup.button.callback(
                      '🔴 Rechazar',
                      `jefe_autorizar:${serviceWithRelations.id}:0`,
                    ),
                  ],
                ]),
              },
            );
          } catch (telegramErr) {
            console.warn(
              `No se pudo enviar notificación de Telegram a la empleada independiente (chatId: ${empUser.telegramChatId}):`,
              telegramErr.message || telegramErr,
            );
          }
        }
        return;
      }

      // Si es de agencia, notifica a los jefes y administradores activos
      const jefes = await this.usuariosRepository.find({
        where: [
          { rol: 'jefe', activo: true },
          { rol: 'admin', activo: true },
        ],
      });

      for (const j of jefes) {
        if (j.telegramChatId && j.telegramChatId !== '111111111') {
          const payload = { sub: j.id, email: j.email, rol: j.rol };
          const token = this.jwtService.sign(payload);
          const port = process.env.PORT || '4000';
          const panelUrl = `http://localhost:${port}/realtime/panel/jefe?token=${token}`;

          const messageText =
            `🔔 *¡Nueva Solicitud de Servicio!* 🔔\n\n` +
            `• *Cliente:* ${serviceWithRelations.cliente?.nombreTelegram || 'Desconocido'}\n` +
            `• *Empleada:* ${serviceWithRelations.empleada?.nombreArtistico || 'N/A'}\n` +
            `• *Duración:* ${serviceWithRelations.duracionPactadaHoras} horas\n` +
            `• *Método de Pago:* ${serviceWithRelations.metodoPago.toUpperCase()}\n` +
            `• *Total:* $${serviceWithRelations.totalFinal || '0.00'}\n\n` +
            `Por favor accede a tu panel para autorizar o rechazar este servicio.`;

          try {
            await this.bot.telegram.sendMessage(j.telegramChatId, messageText, {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [
                  Markup.button.callback(
                    '🟢 Aceptar',
                    `jefe_autorizar:${serviceWithRelations.id}:1`,
                  ),
                  Markup.button.callback(
                    '🔴 Rechazar',
                    `jefe_autorizar:${serviceWithRelations.id}:0`,
                  ),
                ],
              ]),
            });
          } catch (telegramErr) {
            console.warn(
              `No se pudo enviar notificación de Telegram al jefe ${j.email} (chatId: ${j.telegramChatId}):`,
              telegramErr.message || telegramErr,
            );
          }
        }
      }
    } catch (err) {
      console.error('Error al enviar notificaciones de Telegram a jefes:', err);
    }
  }
}
