import { Inject, forwardRef } from '@nestjs/common';
import { Update, Ctx, Action } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usuarios } from '../users/entities/user.entity';
import { Servicios } from '../services/entities/service.entity';
import { ServicesService } from '../services/services.service';

@Update()
export class TelegramAdminUpdate {
  constructor(
    @InjectRepository(Usuarios)
    private readonly usuariosRepository: Repository<Usuarios>,
    @InjectRepository(Servicios)
    private readonly serviciosRepository: Repository<Servicios>,
    @Inject(forwardRef(() => ServicesService))
    private readonly servicesService: ServicesService,
  ) {}

  @Action(/^jefe_autorizar:(.+):([01])$/)
  async onJefeAutorizar(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const user = await this.usuariosRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    if (!user) {
      await ctx.answerCbQuery(
        '❌ No tienes permisos para realizar esta acción.',
        { show_alert: true },
      );
      return;
    }

    const match = (ctx as any).match;
    const serviceId = match[1];
    const accept = match[2] === '1';

    // Obtener información del servicio para validar si es una empleada independiente autorizándose a sí misma
    const servicio = await this.serviciosRepository.findOne({
      where: { id: serviceId },
      relations: { empleada: true, cliente: true },
    });

    if (!servicio) {
      await ctx.answerCbQuery('❌ Servicio no encontrado.', {
        show_alert: true,
      });
      return;
    }

    if (user.rol !== 'jefe' && user.rol !== 'admin') {
      await ctx.answerCbQuery(
        '❌ No tienes permisos para autorizar este servicio.',
        { show_alert: true },
      );
      return;
    }

    await ctx.answerCbQuery();

    const originalText = (ctx.callbackQuery?.message as any)?.text || '';
    // Evitar duplicar la advertencia
    if (originalText.includes('⚠️ ¿Confirmas')) {
      return;
    }

    const warnHeader = `⚠️ *¿Confirmas que deseas ${accept ? 'ACEPTAR' : 'RECHAZAR'} este servicio?*\n\n`;

    await ctx.editMessageText(warnHeader + originalText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '✅ Sí, confirmar',
            `conf_ja:${serviceId}:${accept ? 1 : 0}`,
          ),
          Markup.button.callback('❌ Cancelar', `canc_ja:${serviceId}`),
        ],
      ]),
    });
  }

  @Action(/^conf_ja:(.+):([01])$/)
  async onConfJefeAutorizar(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const user = await this.usuariosRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    if (!user) {
      await ctx.answerCbQuery(
        '❌ No tienes permisos para realizar esta acción.',
        { show_alert: true },
      );
      return;
    }

    const match = (ctx as any).match;
    const serviceId = match[1];
    const accept = match[2] === '1';

    // Obtener información del servicio para validar si es una empleada independiente autorizándose a sí misma
    const servicio = await this.serviciosRepository.findOne({
      where: { id: serviceId },
      relations: { empleada: true, cliente: true },
    });

    if (!servicio) {
      await ctx.answerCbQuery('❌ Servicio no encontrado.', {
        show_alert: true,
      });
      return;
    }

    if (user.rol !== 'jefe' && user.rol !== 'admin') {
      await ctx.answerCbQuery(
        '❌ No tienes permisos para autorizar este servicio.',
        { show_alert: true },
      );
      return;
    }

    try {
      if (accept) {
        await this.servicesService.aceptar(serviceId, user.id);
        await ctx.answerCbQuery('🟢 Servicio Aceptado exitosamente.');
      } else {
        await this.servicesService.rechazar(serviceId, user.id);
        try {
          await ctx.answerCbQuery('🔴 Servicio Rechazado.');
        } catch (e) {
          // ignore
        }
      }

      let originalText = (ctx.callbackQuery?.message as any)?.text || '';
      // Limpiar el encabezado de advertencia si existe
      originalText = originalText.replace(
        /⚠️ \*?¿Confirmas que deseas (ACEPTAR|RECHAZAR) este servicio\?\*?\n\n/,
        '',
      );

      const statusLabel = accept ? '🟢 ACEPTADO' : '🔴 RECHAZADO';

      const options: any = { parse_mode: 'Markdown' };
      if (accept && servicio.cliente?.telegramChatId) {
        options.reply_markup = Markup.inlineKeyboard([
          [
            Markup.button.url(
              '💬 Contactar Cliente',
              `tg://user?id=${servicio.cliente.telegramChatId}`,
            ),
          ],
        ]).reply_markup;
      }

      await ctx.editMessageText(
        originalText + `\n\n📢 *Resolución:* ${statusLabel} por ${user.email}`,
        options,
      );
    } catch (err: any) {
      console.error('Error al autorizar servicio desde Telegram:', err);
      await ctx.answerCbQuery(
        err.message || 'Error al procesar la solicitud.',
        { show_alert: true },
      );
    }
  }

  @Action(/^canc_ja:(.+)$/)
  async onCancJefeAutorizar(@Ctx() ctx: Context) {
    await ctx.answerCbQuery('Acción cancelada.');
    const match = (ctx as any).match;
    const serviceId = match[1];

    let originalText = (ctx.callbackQuery?.message as any)?.text || '';
    // Limpiar el encabezado de advertencia si existe
    originalText = originalText.replace(
      /⚠️ \*?¿Confirmas que deseas (ACEPTAR|RECHAZAR) este servicio\?\*?\n\n/,
      '',
    );

    await ctx.editMessageText(originalText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('🟢 Aceptar', `jefe_autorizar:${serviceId}:1`),
          Markup.button.callback(
            '🔴 Rechazar',
            `jefe_autorizar:${serviceId}:0`,
          ),
        ],
      ]),
    });
  }
}
