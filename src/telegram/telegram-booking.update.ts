import { Inject, forwardRef, Logger } from '@nestjs/common';
import { Update, Ctx, Action, On } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { RealtimeEventsService } from '../realtime/realtime.service';
import { Usuarios } from '../users/entities/user.entity';
import { Clientes } from '../clients/entities/client.entity';
import { Empleadas } from '../employees/entities/employee.entity';
import { Servicios } from '../services/entities/service.entity';
import { ServicesService } from '../services/services.service';
import { TelegramService } from './telegram.service';
import { TelegramAuthUpdate } from './telegram-auth.update';
import { TelegramCatalogUpdate } from './telegram-catalog.update';

interface SessionData {
  step?:
    | 'AWAITING_DURATION'
    | 'AWAITING_PAYMENT_METHOD'
    | 'AWAITING_LOCATION'
    | 'AWAITING_RATING_COMMENT'
    | 'AWAITING_DURATION_ENCADENADO'
    | 'AWAITING_PAYMENT_METHOD_ENCADENADO'
    | 'AWAITING_LOCATION_ENCADENADO';
  empleadaId?: string;
  duracionPactadaHoras?: number;
  metodoPago?: 'efectivo' | 'tarjeta' | 'transferencia';
  servicioIdCalificacion?: string;
  /** ID del servicio en_curso al que se encadenará la nueva cita */
  servicioPrevioId?: string;
}

interface BotContext extends Context {
  session?: SessionData;
}

@Update()
export class TelegramBookingUpdate {
  private readonly logger = new Logger(TelegramBookingUpdate.name);

  constructor(
    @InjectRepository(Usuarios)
    private readonly usuariosRepository: Repository<Usuarios>,
    @InjectRepository(Clientes)
    private readonly clientesRepository: Repository<Clientes>,
    @InjectRepository(Empleadas)
    private readonly empleadasRepository: Repository<Empleadas>,
    @InjectRepository(Servicios)
    private readonly serviciosRepository: Repository<Servicios>,
    private readonly realtimeEventsService: RealtimeEventsService,
    private readonly jwtService: JwtService,
    @Inject(forwardRef(() => ServicesService))
    private readonly servicesService: ServicesService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    @Inject(forwardRef(() => TelegramAuthUpdate))
    private readonly telegramAuthUpdate: TelegramAuthUpdate,
    @Inject(forwardRef(() => TelegramCatalogUpdate))
    private readonly telegramCatalogUpdate: TelegramCatalogUpdate,
  ) {}

  @Action(/^contratar_empleada:(.+)$/)
  async onContratarEmpleada(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    const match = (ctx as any).match;
    if (!match) return;
    const empleadaId = match[1];

    const empleada = await this.empleadasRepository.findOne({
      where: { id: empleadaId },
    });

    if (!empleada || !empleada.disponible) {
      await ctx.reply(
        'La empleada seleccionada no está disponible en este momento (está ocupada o inactiva).',
      );
      return;
    }

    if (!ctx.session) {
      ctx.session = {};
    }

    ctx.session.step = 'AWAITING_DURATION';
    ctx.session.empleadaId = empleadaId;

    try {
      await ctx.editMessageText(
        `Has seleccionado a *${empleada.nombreArtistico}*.\n\n` +
          `⏱️ *Selecciona la duración pactada* del servicio en horas usando los botones, o escribe una duración personalizada directamente en el chat (ejemplo: 2.5):`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('1 Hora', 'duracion_1'),
              Markup.button.callback('2 Horas', 'duracion_2'),
              Markup.button.callback('3 Horas', 'duracion_3'),
            ],
            [
              Markup.button.callback('4 Horas', 'duracion_4'),
              Markup.button.callback('5 Horas', 'duracion_5'),
              Markup.button.callback('6 Horas', 'duracion_6'),
            ],
            [Markup.button.callback('8 Horas', 'duracion_8')],
          ]),
        },
      );
    } catch (err) {
      // Fallback if we cannot edit the message (e.g. if the message was deleted or isn't editable)
      await ctx.reply(
        `Has seleccionado a *${empleada.nombreArtistico}*.\n\n` +
          `⏱️ *Selecciona la duración pactada* del servicio en horas usando los botones, o escribe una duración personalizada directamente en el chat (ejemplo: 2.5):`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('1 Hora', 'duracion_1'),
              Markup.button.callback('2 Horas', 'duracion_2'),
              Markup.button.callback('3 Horas', 'duracion_3'),
            ],
            [
              Markup.button.callback('4 Horas', 'duracion_4'),
              Markup.button.callback('5 Horas', 'duracion_5'),
              Markup.button.callback('6 Horas', 'duracion_6'),
            ],
            [Markup.button.callback('8 Horas', 'duracion_8')],
          ]),
        },
      );
    }
  }

  // ─── FLUJO CITA ENCADENADA ──────────────────────────────────────────────────

  @Action(/^reservar_siguiente:(.+)$/)
  async onReservarSiguiente(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    const match = (ctx as any).match;
    if (!match) return;
    const empleadaId = match[1];

    const empleada = await this.empleadasRepository.findOne({
      where: { id: empleadaId },
    });

    if (!empleada) {
      await ctx.reply('La empleada seleccionada ya no existe en el sistema.');
      return;
    }

    if (empleada.disponible) {
      // Race condition: she just became available – redirect to normal flow
      await ctx.reply(
        `✅ ¡${empleada.nombreArtistico} acaba de quedar disponible! Puedes contratarla directamente.`,
        Markup.inlineKeyboard([
          Markup.button.callback(
            '🤝 Contratar ahora',
            `contratar_empleada:${empleada.id}`,
          ),
        ]),
      );
      return;
    }

    // Find her active service to link the chain
    const servicioActivo =
      await this.servicesService.findServicioActivoDeEmpleada(empleadaId);
    if (!servicioActivo) {
      await ctx.reply(
        '⚠️ No se encontró un servicio activo para esta empleada. Por favor, intenta más tarde.',
      );
      return;
    }

    if (!ctx.session) ctx.session = {};
    ctx.session.step = 'AWAITING_DURATION_ENCADENADO';
    ctx.session.empleadaId = empleadaId;
    ctx.session.servicioPrevioId = servicioActivo.id;

    const horaEstimada = servicioActivo.horaInicioServicio
      ? new Date(
          servicioActivo.horaInicioServicio.getTime() +
            Number(servicioActivo.duracionPactadaHoras) * 60 * 60 * 1000,
        ).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
      : 'próximamente';

    await ctx.reply(
      `📅 *Reservar Siguiente Turno con ${empleada.nombreArtistico}*\n\n` +
        `⏰ Hora de inicio estimada: *${horaEstimada}* (puede variar si la empleada extiende su servicio actual)\n\n` +
        `¿Cuántas horas necesitas?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('1 Hora', 'enc_duracion_1'),
            Markup.button.callback('2 Horas', 'enc_duracion_2'),
            Markup.button.callback('3 Horas', 'enc_duracion_3'),
          ],
          [
            Markup.button.callback('4 Horas', 'enc_duracion_4'),
            Markup.button.callback('5 Horas', 'enc_duracion_5'),
            Markup.button.callback('6 Horas', 'enc_duracion_6'),
          ],
          [Markup.button.callback('8 Horas', 'enc_duracion_8')],
        ]),
      },
    );
  }

  @Action(/^enc_duracion_(\d+(\.\d+)?)$/)
  async onEncDuracion(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    if (ctx.session?.step !== 'AWAITING_DURATION_ENCADENADO') {
      await ctx.reply('No hay ningún proceso de reserva activo.');
      return;
    }
    const match = (ctx as any).match;
    const duracion = parseFloat(match[1]);
    ctx.session.duracionPactadaHoras = duracion;
    ctx.session.step = 'AWAITING_PAYMENT_METHOD_ENCADENADO';

    await ctx.reply(
      `⏱️ Duración registrada: *${duracion} horas*.\n\n💳 Selecciona el método de pago:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('💵 Efectivo', 'enc_pago_efectivo'),
            Markup.button.callback('💳 Tarjeta', 'enc_pago_tarjeta'),
          ],
          [
            Markup.button.callback(
              '🏦 Transferencia',
              'enc_pago_transferencia',
            ),
          ],
        ]),
      },
    );
  }

  @Action(/^enc_pago_(efectivo|tarjeta|transferencia)$/)
  async onEncPago(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    if (ctx.session?.step !== 'AWAITING_PAYMENT_METHOD_ENCADENADO') {
      await ctx.reply('No hay ningún proceso de reserva activo.');
      return;
    }
    const match = (ctx as any).match;
    const metodo = match[1] as 'efectivo' | 'tarjeta' | 'transferencia';
    ctx.session.metodoPago = metodo;
    ctx.session.step = 'AWAITING_LOCATION_ENCADENADO';

    await ctx.reply(
      `✅ Método de pago: *${metodo.toUpperCase()}*.\n\n📍 Por último, comparte tu ubicación:`,
      {
        parse_mode: 'Markdown',
        ...Markup.keyboard([
          [Markup.button.locationRequest('📍 Compartir mi Ubicación')],
        ])
          .oneTime()
          .resize(),
      },
    );
  }

  @Action(/^duracion_(\d+(\.\d+)?)$/)
  async onSelectDuration(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    if (ctx.session?.step !== 'AWAITING_DURATION') {
      await ctx.reply('No hay ningún proceso de contratación activo.');
      return;
    }

    const match = (ctx as any).match;
    const duracion = parseFloat(match[1]);

    ctx.session.duracionPactadaHoras = duracion;
    ctx.session.step = 'AWAITING_PAYMENT_METHOD';

    try {
      await ctx.editMessageText(
        `⏱️ Duración registrada: *${duracion} horas*.\n\n` +
          `💳 Ahora, selecciona el método de pago:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('💵 Efectivo', 'pago_efectivo'),
              Markup.button.callback('💳 Tarjeta', 'pago_tarjeta'),
            ],
            [Markup.button.callback('🏦 Transferencia', 'pago_transferencia')],
          ]),
        },
      );
    } catch (err) {
      await ctx.reply(
        `⏱️ Duración registrada: *${duracion} horas*.\n\n` +
          `💳 Ahora, selecciona el método de pago:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('💵 Efectivo', 'pago_efectivo'),
              Markup.button.callback('💳 Tarjeta', 'pago_tarjeta'),
            ],
            [Markup.button.callback('🏦 Transferencia', 'pago_transferencia')],
          ]),
        },
      );
    }
  }

  @Action(/^pago_(efectivo|tarjeta|transferencia)$/)
  async onSelectPayment(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    if (ctx.session?.step !== 'AWAITING_PAYMENT_METHOD') {
      await ctx.reply('No hay ningún proceso de contratación activo.');
      return;
    }

    const match = (ctx as any).match;
    const metodo = match[1] as 'efectivo' | 'tarjeta' | 'transferencia';

    ctx.session.metodoPago = metodo;
    ctx.session.step = 'AWAITING_LOCATION';

    try {
      // Editar el mensaje para remover los botones inline de pago
      await ctx.editMessageText(
        `⏱️ Duración registrada: *${ctx.session.duracionPactadaHoras} horas*.\n` +
          `✅ Método de pago seleccionado: *${metodo.toUpperCase()}*.\n\n` +
          `📍 Siguiente paso: Compartir ubicación.`,
        { parse_mode: 'Markdown' },
      );
    } catch (err) {
      console.error('Error al editar mensaje de pago:', err);
    }

    // Enviar el teclado nativo para compartir ubicación
    await ctx.reply(
      `📍 Por último, necesitamos tu ubicación para registrar el servicio.\n` +
        `Por favor, presiona el botón de abajo para compartir tu ubicación de manera segura:`,
      {
        parse_mode: 'Markdown',
        ...Markup.keyboard([
          [Markup.button.locationRequest('📍 Compartir mi Ubicación')],
        ])
          .oneTime()
          .resize(),
      },
    );
  }

  @Action(/^finalizar_servicio:(.+)$/)
  async onFinalizarServicio(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const match = (ctx as any).match;
    if (!match) return;
    const servicioId = match[1];

    const servicio = await this.serviciosRepository.findOne({
      where: { id: servicioId },
      relations: {
        cliente: true,
        empleada: { usuario: true, jefe: true },
        jefe: true,
      },
    });

    if (!servicio) {
      await ctx.answerCbQuery('❌ Servicio no encontrado.', {
        show_alert: true,
      });
      return;
    }

    if (servicio.estado === 'finalizado') {
      await ctx.answerCbQuery('⚠️ Este servicio ya fue finalizado.', {
        show_alert: true,
      });
      return;
    }

    // Cambiar estado a finalizado
    servicio.estado = 'finalizado';
    const fin = new Date();
    servicio.horaFinServicio = fin;

    // Calcular duración real en horas y formato legible (horas, minutos, segundos)
    let duracionRealStr = servicio.duracionPactadaHoras;
    let duracionRealVal = parseFloat(servicio.duracionPactadaHoras);
    let duracionFormatted = `${servicio.duracionPactadaHoras} horas`;
    if (servicio.horaInicioServicio) {
      const inicio = new Date(servicio.horaInicioServicio);
      const diffMs = fin.getTime() - inicio.getTime();
      duracionRealVal = diffMs / (1000 * 60 * 60);
      duracionRealStr = duracionRealVal.toFixed(2);

      const totalSeconds = Math.floor(diffMs / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      const parts: string[] = [];
      if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hora' : 'horas'}`);
      if (minutes > 0)
        parts.push(`${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`);
      if (seconds > 0 || parts.length === 0)
        parts.push(`${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}`);
      duracionFormatted = parts.join(', ');
    }
    servicio.duracionFinalHoras = duracionRealStr;
    await this.serviciosRepository.save(servicio);

    // Actualizar disponibilidad de la empleada a true (disponible)
    if (servicio.empleadaId) {
      await this.empleadasRepository.update(servicio.empleadaId, {
        disponible: true,
      });
    }

    await ctx.answerCbQuery('🏁 Servicio finalizado con éxito.');

    // Volver a cargar para obtener totales calculados por triggers
    const servicioActualizado = await this.serviciosRepository.findOne({
      where: { id: servicioId },
      relations: {
        cliente: true,
        empleada: { usuario: true, jefe: true },
        jefe: true,
      },
    });

    const total =
      servicioActualizado?.totalFinal || servicio.totalFinal || '0.00';

    // 1. Editar el mensaje del botón "Finalizar Servicio" con el resumen del servicio
    const resumenEmpText =
      `✅ *¡Servicio Finalizado!* 🏁\n\n` +
      `📝 *Resumen del Servicio:*\n` +
      `• *Cliente:* ${servicio.cliente?.nombreTelegram || 'Desconocido'}\n` +
      `• *Duración Pactada:* ${servicio.duracionPactadaHoras} horas\n` +
      `• *Duración Real:* ${duracionFormatted}\n` +
      `• *Total Cobrado:* $${total}\n` +
      `• *Método de Pago:* ${servicio.metodoPago.toUpperCase()}\n\n` +
      `¡Excelente trabajo! 🎉`;

    try {
      await ctx.editMessageText(resumenEmpText, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('Error al editar mensaje de resumen de la empleada:', err);
    }

    // 2. Limpieza de chat del cliente (Eliminar mensaje anterior)
    if (servicio.cliente?.telegramChatId && servicio.telegramClienteMensajeId) {
      try {
        await ctx.telegram.deleteMessage(
          servicio.cliente.telegramChatId,
          parseInt(servicio.telegramClienteMensajeId, 10),
        );
      } catch (err) {
        console.error('Error al eliminar mensaje del cliente:', err);
      }
    }

    // 3. Enviar mensaje de resumen y solicitar calificación al cliente
    if (servicio.cliente?.telegramChatId) {
      const resumenCliText =
        `🏁 *¡Tu servicio ha finalizado!* 🍰\n\n` +
        `📝 *Resumen de tu Servicio:*\n` +
        `• *Empleada:* ${servicio.empleada?.nombreArtistico || 'N/A'}\n` +
        `• *Duración Pactada:* ${servicio.duracionPactadaHoras} horas\n` +
        `• *Duración Real:* ${duracionFormatted}\n` +
        `• *Total a Pagar:* $${total}\n` +
        `• *Método de Pago:* ${servicio.metodoPago.toUpperCase()}\n\n` +
        `Por favor, califica el servicio recibido:`;

      const duracionPactadaVal = parseFloat(servicio.duracionPactadaHoras);
      const finalizoAntes = duracionRealVal < duracionPactadaVal;

      const inlineButtons: any[] = [
        [
          Markup.button.callback('⭐', `calificar_servicio:${servicio.id}:1`),
          Markup.button.callback('⭐⭐', `calificar_servicio:${servicio.id}:2`),
          Markup.button.callback(
            '⭐⭐⭐',
            `calificar_servicio:${servicio.id}:3`,
          ),
        ],
        [
          Markup.button.callback(
            '⭐⭐⭐⭐',
            `calificar_servicio:${servicio.id}:4`,
          ),
          Markup.button.callback(
            '⭐⭐⭐⭐⭐',
            `calificar_servicio:${servicio.id}:5`,
          ),
        ],
      ];

      const jefeEncargado = servicio.empleada?.jefe || servicio.jefe;
      if (finalizoAntes && jefeEncargado?.telefono) {
        const cleanPhone = jefeEncargado.telefono.replace(/[^0-9]/g, '');
        const messageText =
          `Hola, soy el cliente ${servicio.cliente?.nombreTelegram || ''}.\n` +
          `Quiero contactar con soporte sobre mi servicio:\n` +
          `• ID del Servicio: ${servicio.id}\n` +
          `• Empleada: ${servicio.empleada?.nombreArtistico || ''}\n` +
          `• Hora de inicio: ${servicio.horaInicioServicio ? new Date(servicio.horaInicioServicio).toLocaleString() : ''}\n` +
          `• Hora de fin: ${fin.toLocaleString()}\n` +
          `• Tiempo total: ${duracionFormatted}\n` +
          `• Horas pactadas originalmente: ${servicio.duracionPactadaHoras} horas`;

        const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(messageText)}`;
        inlineButtons.push([Markup.button.url('📞 Contactar Soporte', waUrl)]);
      }

      try {
        await ctx.telegram.sendMessage(
          servicio.cliente.telegramChatId,
          resumenCliText,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(inlineButtons),
          },
        );
      } catch (err) {
        console.error(
          'Error al notificar al cliente del fin de servicio:',
          err,
        );
      }
    }

    // 4. Notificar a clientes con citas encadenadas que su turno está próximo
    //    (el trigger de PostgreSQL ya cambia el estado a 'pendiente' automáticamente)
    try {
      const serviciosEncadenados = await this.serviciosRepository.find({
        where: {
          servicioPrevioId: servicioId,
          estado: 'pendiente' as any, // just activated by PG trigger
        },
        relations: { cliente: true, empleada: true },
        order: { createdAt: 'ASC' },
      });

      for (const enc of serviciosEncadenados) {
        if (!enc.cliente?.telegramChatId) continue;
        try {
          await ctx.telegram.sendMessage(
            enc.cliente.telegramChatId,
            `🟢 *¡Tu turno está activo!*\n\n` +
              `La empleada *${servicio.empleada?.nombreArtistico || ''}* acaba de quedar libre.\n` +
              `Tu servicio ha pasado a lista de espera de aprobación. Pronto un administrador lo confirmará.`,
            { parse_mode: 'Markdown' },
          );
        } catch (tgErr) {
          console.error(
            `Error notificando cliente encadenado activado (chatId: ${enc.cliente.telegramChatId}):`,
            tgErr,
          );
        }
      }
    } catch (encErr) {
      console.error(
        'Error al procesar notificaciones de cadena al finalizar:',
        encErr,
      );
    }
  }

  @Action(/^calificar_servicio:(.+):([1-5])$/)
  async onCalificarServicio(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    const match = (ctx as any).match;
    if (!match) return;
    const servicioId = match[1];
    const rating = parseInt(match[2], 10);

    const servicio = await this.serviciosRepository.findOne({
      where: { id: servicioId },
    });

    if (!servicio) {
      await ctx.reply('❌ Servicio no encontrado.');
      return;
    }

    servicio.calificacion = rating;
    await this.serviciosRepository.save(servicio);

    const stars = '⭐'.repeat(rating);

    if (rating >= 3) {
      await ctx.editMessageText(
        `Muchas gracias por calificar con ${stars} el servicio de nuestra empleada. ¡Agradecemos tu preferencia!`,
      );
      await ctx.reply(
        'Selecciona una opción:',
        Markup.keyboard([
          ['🏠 Volver al menú', '👩‍🍳 Ver empleadas'],
          ['📖 Ver ayuda'],
        ]).resize(),
      );
    } else {
      if (!ctx.session) {
        ctx.session = {};
      }
      ctx.session.step = 'AWAITING_RATING_COMMENT';
      ctx.session.servicioIdCalificacion = servicioId;

      await ctx.editMessageText(
        `Has calificado con ${stars} nuestro servicio.\n\n` +
          `⚠️ *Comentario Obligatorio:*\n` +
          `Lamentamos mucho tu insatisfacción. Por favor, escribe un comentario directamente en el chat explicándonos qué podemos mejorar:`,
        { parse_mode: 'Markdown' },
      );
    }
  }

  @On(['location', 'venue'])
  async onLocation(@Ctx() ctx: BotContext) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const message = ctx.message as any;
    let lat: string;
    let lng: string;
    let notasUbicacion: string | null = null;

    if (message?.venue) {
      const venue = message.venue;
      lat = venue.location.latitude.toString();
      lng = venue.location.longitude.toString();
      notasUbicacion = `Lugar seleccionado: ${venue.title}\nDirección: ${venue.address}`;
    } else if (message?.location) {
      const location = message.location;
      lat = location.latitude.toString();
      lng = location.longitude.toString();
    } else {
      await ctx.reply(
        '❌ No se pudo obtener la ubicación. Por favor intenta de nuevo.',
      );
      return;
    }

    // Verificar si es personal del sistema (chofer o empleada)
    const user = await this.usuariosRepository.findOne({
      where: { telegramChatId: telegramId },
      relations: { choferes: true, empleadas: true },
    });

    if (user) {
      if (user.rol === 'chofer' && user.choferes) {
        user.choferes.ubicacionLat = lat;
        user.choferes.ubicacionLng = lng;
        user.choferes.ultimaUbicacionAt = new Date();
        await this.usuariosRepository.manager.save(user.choferes);
        await ctx.reply(
          `📍 Ubicación actualizada correctamente para el chofer: ${user.choferes.nombre}`,
        );
        return;
      }

      if (user.rol === 'empleada' && user.empleadas) {
        user.empleadas.ubicacionLat = lat;
        user.empleadas.ubicacionLng = lng;
        user.empleadas.ultimaUbicacionAt = new Date();
        await this.usuariosRepository.manager.save(user.empleadas);
        await ctx.reply(
          `📍 Ubicación actualizada correctamente para la empleada: ${user.empleadas.nombreArtistico}`,
        );
        return;
      }
    }

    // Si no es personal, continuar flujo de cliente
    const step = ctx.session?.step;
    if (
      step !== 'AWAITING_LOCATION' &&
      step !== 'AWAITING_LOCATION_ENCADENADO'
    ) {
      await ctx.reply(
        'Por favor, inicia la contratación de una empleada desde el catálogo primero.',
      );
      return;
    }

    const isEncadenado = step === 'AWAITING_LOCATION_ENCADENADO';

    const { empleadaId, duracionPactadaHoras, metodoPago, servicioPrevioId } =
      ctx.session || {};

    if (!empleadaId || !duracionPactadaHoras || !metodoPago) {
      await ctx.reply(
        '❌ Datos incompletos del proceso. Por favor inicia nuevamente.',
      );
      if (ctx.session) ctx.session = {};
      return;
    }

    const client = await this.clientesRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    if (!client) {
      await ctx.reply('❌ Cliente no encontrado. Por favor inicia con /start');
      ctx.session = {};
      return;
    }

    const empleada = await this.empleadasRepository.findOne({
      where: { id: empleadaId },
    });

    if (!empleada) {
      await ctx.reply('La empleada seleccionada ya no está disponible.');
      ctx.session = {};
      return;
    }

    const isIndependent = empleada.tipo === 'independiente';
    let jefeId: string;

    if (isIndependent) {
      jefeId = empleada.usuarioId;
    } else {
      let jefe: Usuarios | null = null;
      if (empleada.jefeId) {
        jefe = await this.usuariosRepository.findOne({
          where: { id: empleada.jefeId, activo: true },
        });
      }
      if (!jefe) {
        jefe = await this.usuariosRepository.findOne({
          where: [
            { rol: 'jefe', activo: true },
            { rol: 'admin', activo: true },
          ],
        });
      }

      if (!jefe) {
        await ctx.reply(
          '❌ No hay ningún jefe o administrador activo asignado en el sistema en este momento para autorizar el servicio.',
        );
        return;
      }
      jefeId = jefe.id;
    }

    // ─── FLUJO ENCADENADO ───────────────────────────────────────────────────
    if (isEncadenado) {
      const nuevoServicioEnc = this.serviciosRepository.create({
        clienteId: client.id,
        empleadaId: empleada.id,
        jefeId: jefeId,
        duracionPactadaHoras: duracionPactadaHoras.toString(),
        metodoPago: metodoPago,
        ubicacionClienteLat: lat,
        ubicacionClienteLng: lng,
        precioBaseHoraPactado: empleada.precioBaseHora.toString(),
        estado: 'pendiente_encadenado',
        notas: notasUbicacion,
        servicioPrevioId: servicioPrevioId || null,
        clienteTelegramId: telegramId,
        iaActiva: false,
      });

      const jefeUser = await this.usuariosRepository.findOne({
        where: { id: jefeId },
      });
      if (jefeUser && jefeUser.grupoTelegramId) {
        try {
          const clientName =
            client.nombreTelegram || ctx.from?.first_name || 'Cliente';
          const topic = await ctx.telegram.createForumTopic(
            jefeUser.grupoTelegramId,
            `👤 Cliente: ${clientName}`,
          );
          nuevoServicioEnc.telegramThreadId =
            topic.message_thread_id.toString();

          const detailsMsg =
            `📋 *Información del Servicio (Cita Encadenada):*\n\n` +
            `• *Cliente:* ${clientName} (ID: ${telegramId})\n` +
            `• *Empleada:* ${empleada.nombreArtistico}\n` +
            `• *Duración:* ${duracionPactadaHoras} horas\n` +
            `• *Método de Pago:* ${metodoPago.toUpperCase()}\n` +
            `• *Tarifa:* $${empleada.precioBaseHora}/hr\n` +
            (notasUbicacion ? `• *Ubicación/Notas:* ${notasUbicacion}\n` : '') +
            `• *Estado:* Pendiente Encadenada`;
          await ctx.telegram.sendMessage(jefeUser.grupoTelegramId, detailsMsg, {
            message_thread_id: topic.message_thread_id,
            parse_mode: 'Markdown',
            ...Markup.keyboard([
              ['🟢 Aceptar Servicio', '🔴 Rechazar Servicio'],
            ])
              .resize()
              .oneTime(),
          });
          await ctx.telegram.sendLocation(
            jefeUser.grupoTelegramId,
            parseFloat(lat),
            parseFloat(lng),
            { message_thread_id: topic.message_thread_id },
          );
        } catch (err) {
          this.logger.error(
            'Error al crear forum topic para servicio encadenado:',
            err,
          );
        }
      }
      await this.serviciosRepository.save(nuevoServicioEnc);

      // Calculate estimated start time from the active service
      let horaEstimadaStr = 'próximamente';
      if (servicioPrevioId) {
        const servicioActivo = await this.serviciosRepository.findOne({
          where: { id: servicioPrevioId },
        });
        if (servicioActivo?.horaInicioServicio) {
          const estimada = new Date(
            servicioActivo.horaInicioServicio.getTime() +
              Number(servicioActivo.duracionPactadaHoras) * 60 * 60 * 1000,
          );
          // Save to the new chained service
          nuevoServicioEnc.horaInicioEstimada = estimada;
          await this.serviciosRepository.save(nuevoServicioEnc);
          horaEstimadaStr = estimada.toLocaleTimeString('es-MX', {
            hour: '2-digit',
            minute: '2-digit',
          });
        }
      }

      ctx.session = {};

      let msgEnc =
        `📅 *¡Cita Encadenada Registrada!*\n\n` +
        `📝 *Resumen:*\n` +
        `• *Empleada:* ${empleada.nombreArtistico}\n` +
        `• *Duración:* ${duracionPactadaHoras} horas\n` +
        `• *Método de Pago:* ${metodoPago.toUpperCase()}\n` +
        `• *Tarifa:* $${empleada.precioBaseHora}/hr\n` +
        `• *Inicio estimado:* ${horaEstimadaStr}\n\n` +
        `⏳ Tu cita está en la lista de espera. Te avisaremos tan pronto la empleada quede libre.\n` +
        `Puedes cancelar esta reserva presionando el botón de abajo:`;

      if (notasUbicacion) {
        msgEnc += `\n• *Ubicación:* ${notasUbicacion}`;
      }

      const msgEnviadoEnc = await ctx.reply(msgEnc, {
        parse_mode: 'Markdown',
        ...Markup.removeKeyboard(),
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '❌ Cancelar esta Reserva',
              `cancelar_encadenado:${nuevoServicioEnc.id}`,
            ),
          ],
        ]),
      });

      nuevoServicioEnc.telegramClienteMensajeId =
        msgEnviadoEnc.message_id.toString();
      await this.serviciosRepository.save(nuevoServicioEnc);

      // Notify jefe of new chained service
      try {
        await this.telegramService.notifyJefesNewService(nuevoServicioEnc.id);
      } catch (err) {
        console.error('Error notificando jefe sobre cita encadenada:', err);
      }

      return;
    }

    // ─── FLUJO NORMAL ────────────────────────────────────────────────────────
    const nuevoServicio = this.serviciosRepository.create({
      clienteId: client.id,
      empleadaId: empleada.id,
      jefeId: jefeId,
      duracionPactadaHoras: duracionPactadaHoras.toString(),
      metodoPago: metodoPago,
      ubicacionClienteLat: lat,
      ubicacionClienteLng: lng,
      precioBaseHoraPactado: empleada.precioBaseHora.toString(),
      estado: 'pendiente',
      notas: notasUbicacion,
      clienteTelegramId: telegramId,
      iaActiva: false,
    });

    const jefeUser = await this.usuariosRepository.findOne({
      where: { id: jefeId },
    });
    if (jefeUser && jefeUser.grupoTelegramId) {
      try {
        const clientName =
          client.nombreTelegram || ctx.from?.first_name || 'Cliente';
        const topic = await ctx.telegram.createForumTopic(
          jefeUser.grupoTelegramId,
          `👤 Cliente: ${clientName}`,
        );
        nuevoServicio.telegramThreadId = topic.message_thread_id.toString();

        const detailsMsg =
          `📋 *Información del Servicio:*\n\n` +
          `• *Cliente:* ${clientName} (ID: ${telegramId})\n` +
          `• *Empleada:* ${empleada.nombreArtistico}\n` +
          `• *Duración:* ${duracionPactadaHoras} horas\n` +
          `• *Método de Pago:* ${metodoPago.toUpperCase()}\n` +
          `• *Tarifa:* $${empleada.precioBaseHora}/hr\n` +
          (notasUbicacion ? `• *Ubicación/Notas:* ${notasUbicacion}\n` : '') +
          `• *Estado:* Pendiente`;
        await ctx.telegram.sendMessage(jefeUser.grupoTelegramId, detailsMsg, {
          message_thread_id: topic.message_thread_id,
          parse_mode: 'Markdown',
          ...Markup.keyboard([['🟢 Aceptar Servicio', '🔴 Rechazar Servicio']])
            .resize()
            .oneTime(),
        });
        await ctx.telegram.sendLocation(
          jefeUser.grupoTelegramId,
          parseFloat(lat),
          parseFloat(lng),
          { message_thread_id: topic.message_thread_id },
        );
      } catch (err) {
        this.logger.error(
          'Error al crear forum topic para servicio normal:',
          err,
        );
      }
    }
    await this.serviciosRepository.save(nuevoServicio);

    // Emit event to Jefes in real-time
    const serviceWithRelations = await this.serviciosRepository.findOne({
      where: { id: nuevoServicio.id },
      relations: { cliente: true, empleada: true },
    });
    if (serviceWithRelations) {
      this.realtimeEventsService.emitToJefes({
        type: 'service_requested',
        data: serviceWithRelations,
      });

      try {
        await this.telegramService.notifyJefesNewService(
          serviceWithRelations.id,
        );
      } catch (err) {
        console.error(
          'Error al enviar notificaciones de Telegram para el nuevo servicio:',
          err,
        );
      }
    }

    ctx.session = {};

    let msgExito =
      `🎉 *¡Servicio Solicitado con Éxito!*\n\n` +
      `📝 *Resumen del Servicio:*\n` +
      `• *Empleada:* ${empleada.nombreArtistico}\n` +
      `• *Duración:* ${duracionPactadaHoras} horas\n` +
      `• *Método de Pago:* ${metodoPago.toUpperCase()}\n` +
      `• *Tarifa Pactada:* $${empleada.precioBaseHora}/hr\n` +
      `• *Estado:* Pendiente de aprobación\n`;

    if (notasUbicacion) {
      msgExito += `• *Ubicación:* ${message.venue.title} (${message.venue.address})\n`;
    }

    msgExito += `\nPronto un administrador se pondrá en contacto contigo. ¡Gracias por tu preferencia!`;

    const msg = await ctx.reply(msgExito, {
      parse_mode: 'Markdown',
      ...Markup.removeKeyboard(),
    });

    nuevoServicio.telegramClienteMensajeId = msg.message_id.toString();
    await this.serviciosRepository.save(nuevoServicio);
  }

  @Action(/^extender_servicio:(.+):(.+)$/)
  async onExtenderServicio(@Ctx() ctx: Context) {
    const match = (ctx as any).match;
    if (!match) return;
    const servicioId = match[1];
    const horasAExtender = parseInt(match[2], 10);

    const servicio = await this.serviciosRepository.findOne({
      where: { id: servicioId },
      relations: { empleada: { usuario: true } },
    });

    if (!servicio) {
      await ctx.answerCbQuery('❌ Servicio no encontrado.');
      return;
    }

    if (servicio.estado !== 'en_curso') {
      await ctx.answerCbQuery('⚠️ El servicio ya no está activo.');
      return;
    }

    // Actualizar duracion pactada
    const nuevaDuracion =
      Number(servicio.duracionPactadaHoras) + horasAExtender;
    servicio.duracionPactadaHoras = nuevaDuracion.toString();
    // Resetear flag para que pueda volver a notificar 15 minutos antes de la nueva hora
    servicio.notificacionExtensionEnviada = false;

    await this.serviciosRepository.save(servicio);
    await ctx.answerCbQuery('✅ Servicio extendido con éxito.');

    // Volver a cargar para ver los totales actualizados por los triggers de Postgres
    const servicioActualizado = await this.serviciosRepository.findOne({
      where: { id: servicioId },
    });

    const total = servicioActualizado?.totalFinal || servicio.totalFinal;

    try {
      await ctx.editMessageText(
        `✅ *Servicio Extendido* ➕${horasAExtender}h\n\n` +
          `• Nueva Duración Pactada: *${nuevaDuracion} horas*\n` +
          `• Nuevo Total Estimado: *$${total}*\n\n` +
          `El cambio ha sido registrado automáticamente en el sistema.`,
        { parse_mode: 'Markdown' },
      );
    } catch (err) {
      console.error('Error al editar mensaje de extensión:', err);
    }

    // Notificar a los clientes de los servicios encadenados que la hora estimada cambió
    try {
      const serviciosEncadenados = await this.serviciosRepository.find({
        where: { servicioPrevioId: servicioId, estado: 'pendiente_encadenado' },
        relations: { cliente: true },
        order: { createdAt: 'ASC' },
      });

      let horaBase = servicio.horaInicioServicio
        ? new Date(
            servicio.horaInicioServicio.getTime() +
              nuevaDuracion * 60 * 60 * 1000,
          )
        : null;

      for (const enc of serviciosEncadenados) {
        if (!enc.cliente?.telegramChatId) continue;

        const horaEstimadaStr = horaBase
          ? horaBase.toLocaleTimeString('es-MX', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'próximamente';

        try {
          await ctx.telegram.sendMessage(
            enc.cliente.telegramChatId,
            `⚠️ *Actualización de tu Cita Reservada*\n\n` +
              `La empleada *${servicio.empleada?.nombreArtistico || ''}* extendió su servicio actual.\n` +
              `• Nueva hora de inicio estimada para tu cita: *${horaEstimadaStr}*\n\n` +
              `Te avisaremos cuando esté lista para atenderte.`,
            { parse_mode: 'Markdown' },
          );
        } catch (tgErr) {
          console.error(
            `Error notificando cliente encadenado (chatId: ${enc.cliente.telegramChatId}):`,
            tgErr,
          );
        }

        // Advance the window for next service in queue
        if (horaBase) {
          horaBase = new Date(
            horaBase.getTime() +
              Number(enc.duracionPactadaHoras) * 60 * 60 * 1000,
          );
        }
      }
    } catch (encErr) {
      console.error(
        'Error al notificar clientes encadenados de extensión:',
        encErr,
      );
    }
  }

  @Action(/^cancelar_encadenado:(.+)$/)
  async onCancelarEncadenado(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    const match = (ctx as any).match;
    if (!match) return;
    const servicioId = match[1];
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    // Find the client
    const client = await this.clientesRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    if (!client) {
      await ctx.reply('❌ Cliente no encontrado.');
      return;
    }

    try {
      await this.servicesService.cancelarServicioEncadenado(
        servicioId,
        client.id,
      );

      try {
        await ctx.editMessageText(
          `❌ *Reserva Cancelada*\n\nTu cita encadenada ha sido cancelada exitosamente. Puedes volver al catálogo para solicitar una nueva.`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('👩‍🍳 Ver Catálogo', 'ver_empleadas')],
            ]),
          },
        );
      } catch (editErr) {
        await ctx.reply(`❌ Reserva cancelada exitosamente.`);
      }
    } catch (err: any) {
      await ctx.reply(
        `❌ No se pudo cancelar la reserva: ${err?.message || 'Error desconocido'}`,
      );
    }
  }

  @Action(/^no_extender_servicio:(.+)$/)
  async onNoExtenderServicio(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    try {
      await ctx.editMessageText(
        `👍 Entendido. El servicio finalizará en el tiempo pactado inicialmente.`,
        { parse_mode: 'Markdown' },
      );
    } catch (err) {
      console.error('Error al editar mensaje de no extensión:', err);
    }
  }

  @On('text')
  async onMessage(@Ctx() ctx: BotContext) {
    const text = (ctx.message as { text?: string })?.text || '';
    const cleanText = text.trim().toLowerCase();

    const message = ctx.message as any;
    const threadId = message?.message_thread_id;
    const chatId = ctx.chat?.id?.toString();

    // Flujo 2: Respuestas del Jefe desde su Hilo hacia el Cliente (Webhook de Salida)
    if (
      threadId &&
      (ctx.chat?.type === 'supergroup' || ctx.chat?.type === 'group')
    ) {
      const cleanInput = text.trim();
      const isAccept = cleanInput === '🟢 Aceptar Servicio';
      const isReject = cleanInput === '🔴 Rechazar Servicio';

      if (isAccept || isReject) {
        try {
          const senderTelegramId = ctx.from?.id.toString();
          if (!senderTelegramId) return;

          const user = await this.usuariosRepository.findOne({
            where: { telegramChatId: senderTelegramId },
          });

          if (!user) {
            await ctx.reply(
              '❌ No tienes permisos o no estás registrado en el sistema.',
            );
            return;
          }

          const service = await this.serviciosRepository.findOne({
            where: {
              telegramThreadId: threadId.toString(),
              jefe: {
                grupoTelegramId: chatId,
              },
            },
            relations: { empleada: true, cliente: true },
          });

          if (!service) {
            await ctx.reply(
              '❌ No se encontró ningún servicio asociado a este hilo.',
            );
            return;
          }

          const isIndependentEmployee =
            service.empleada &&
            service.empleada.tipo === 'independiente' &&
            service.empleada.usuarioId === user.id;

          if (
            user.rol !== 'jefe' &&
            user.rol !== 'admin' &&
            !isIndependentEmployee
          ) {
            await ctx.reply(
              '❌ No tienes permisos para autorizar este servicio.',
            );
            return;
          }

          if (isAccept) {
            await this.servicesService.aceptar(service.id, user.id);
            await ctx.reply(
              `🟢 *Servicio Aceptado* por ${user.email}`,
              Markup.removeKeyboard(),
            );
          } else {
            await this.servicesService.rechazar(service.id, user.id);
          }
        } catch (err: any) {
          this.logger.error(
            'Error al autorizar servicio por Reply Keyboard:',
            err,
          );
          await ctx.reply(
            `❌ Error: ${err.message || 'Error al procesar la solicitud.'}`,
          );
        }
        return;
      }

      try {
        const service = await this.serviciosRepository.findOne({
          where: {
            telegramThreadId: threadId.toString(),
            jefe: {
              grupoTelegramId: chatId,
            },
          },
        });

        if (service && service.clienteTelegramId) {
          await ctx.telegram.sendMessage(service.clienteTelegramId, text);
        }
      } catch (err) {
        this.logger.error('Error en Flujo 2 (Respuesta del Jefe):', err);
      }
      return;
    }

    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    // Flujo 1: Mensajes del Cliente hacia el Súpergrupo del Jefe Asignado (Webhook de Entrada)
    if (ctx.chat?.type === 'private') {
      try {
        const activeService = await this.serviciosRepository.findOne({
          where: { clienteTelegramId: telegramId },
          relations: {
            jefe: true,
            cliente: true,
            empleada: true,
          },
          order: { createdAt: 'DESC' },
        });

        if (activeService && activeService.iaActiva === false) {
          const jefe = activeService.jefe;
          const grupoTelegramId = jefe?.grupoTelegramId;
          this.logger.log(
            `Procesando mensaje de cliente. activeService.id=${activeService.id}, jefeId=${jefe?.id}, grupoTelegramId=${grupoTelegramId}`,
          );

          if (!grupoTelegramId) {
            this.logger.error(
              `El jefe para el servicio ${activeService.id} no tiene configurado grupoTelegramId.`,
            );
            return;
          }

          if (!activeService.telegramThreadId) {
            const clientName =
              activeService.cliente?.nombreTelegram ||
              ctx.from?.first_name ||
              'Cliente';
            this.logger.log(
              `Creando tema de foro para cliente: ${clientName} en grupo: ${grupoTelegramId}`,
            );
            const topic = await ctx.telegram.createForumTopic(
              grupoTelegramId,
              `👤 Cliente: ${clientName}`,
            );
            this.logger.log(
              `Tema de foro creado con id: ${topic.message_thread_id}`,
            );
            activeService.telegramThreadId = topic.message_thread_id.toString();
            await this.serviciosRepository.save(activeService);

            const detailsMsg =
              `📋 *Información del Servicio:*\n\n` +
              `• *Cliente:* ${clientName} (ID: ${telegramId})\n` +
              `• *Empleada:* ${activeService.empleada?.nombreArtistico || 'N/A'}\n` +
              `• *Duración:* ${activeService.duracionPactadaHoras} horas\n` +
              `• *Método de Pago:* ${activeService.metodoPago.toUpperCase()}\n` +
              `• *Tarifa:* $${activeService.precioBaseHoraPactado}/hr\n` +
              (activeService.notas
                ? `• *Ubicación/Notas:* ${activeService.notas}\n`
                : '') +
              `• *Estado:* ${activeService.estado}`;
            const isPendiente =
              activeService.estado === 'pendiente' ||
              activeService.estado === 'pendiente_encadenado';
            const extraOptions: any = {
              message_thread_id: topic.message_thread_id,
              parse_mode: 'Markdown',
            };
            if (isPendiente) {
              Object.assign(
                extraOptions,
                Markup.keyboard([
                  ['🟢 Aceptar Servicio', '🔴 Rechazar Servicio'],
                ])
                  .resize()
                  .oneTime(),
              );
            }
            await ctx.telegram.sendMessage(
              grupoTelegramId,
              detailsMsg,
              extraOptions,
            );
          }

          await ctx.telegram.sendMessage(grupoTelegramId, text, {
            message_thread_id: parseInt(activeService.telegramThreadId),
          });
          return;
        }
      } catch (err) {
        this.logger.error('Error en Flujo 1 (Cliente -> Súpergrupo):', err);
      }
    }

    if (
      cleanText.includes('volver al menu') ||
      cleanText.includes('volver al menú')
    ) {
      ctx.session = {};
      return this.telegramAuthUpdate.onStart(ctx);
    }

    if (cleanText.includes('ver empleadas')) {
      ctx.session = {};
      return this.telegramCatalogUpdate.listEmpleadas(ctx);
    }

    if (cleanText.includes('ver ayuda') || cleanText.includes('ayuda')) {
      ctx.session = {};
      return this.telegramAuthUpdate.onHelp(ctx);
    }

    const step = ctx.session?.step;

    if (step === 'AWAITING_DURATION') {
      const text = (ctx.message as { text?: string })?.text || '';
      const duracion = parseFloat(text.replace(',', '.'));

      if (isNaN(duracion) || duracion <= 0) {
        await ctx.reply(
          '❌ La duración debe ser un número válido mayor a 0 (ejemplo: 2 o 3.5).\n' +
            'Por favor, intenta nuevamente:',
        );
        return;
      }

      ctx.session!.duracionPactadaHoras = duracion;
      ctx.session!.step = 'AWAITING_PAYMENT_METHOD';

      await ctx.reply(
        `⏱️ Duración registrada: *${duracion} horas*.\n\n` +
          `💳 Ahora, selecciona el método de pago:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('💵 Efectivo', 'pago_efectivo'),
              Markup.button.callback('💳 Tarjeta', 'pago_tarjeta'),
            ],
            [Markup.button.callback('🏦 Transferencia', 'pago_transferencia')],
          ]),
        },
      );
      return;
    }

    if (step === 'AWAITING_RATING_COMMENT') {
      const text = (ctx.message as { text?: string })?.text || '';
      const comments = text.trim();

      if (!comments) {
        await ctx.reply(
          '❌ El comentario es obligatorio para calificaciones de 2 estrellas o menos.\n' +
            'Por favor, indícanos qué podemos mejorar:',
        );
        return;
      }

      const servicioId = ctx.session?.servicioIdCalificacion;
      if (servicioId) {
        const servicio = await this.serviciosRepository.findOne({
          where: { id: servicioId },
        });
        if (servicio) {
          servicio.comentariosCalificacion = comments;
          await this.serviciosRepository.save(servicio);
        }
      }

      ctx.session = {};

      await ctx.reply(
        `Muchas gracias por tus comentarios. Valoramos mucho tu opinión para seguir mejorando.`,
        Markup.keyboard([
          ['🏠 Volver al menú', '👩‍🍳 Ver empleadas'],
          ['📖 Ver ayuda'],
        ]).resize(),
      );
      return;
    }

    const user = await this.usuariosRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    if (user) {
      await ctx.reply(
        `Hola ${user.email} (${user.rol.toUpperCase()}). He recibido tu mensaje. ` +
          `Como personal del sistema, tus consultas se procesarán de inmediato.`,
      );
      return;
    }

    let client = await this.clientesRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    if (!client) {
      const firstName = ctx.from?.first_name || '';
      const username = ctx.from?.username || '';
      const fullName =
        [firstName, ctx.from?.last_name].filter(Boolean).join(' ') ||
        username ||
        'Cliente';

      client = this.clientesRepository.create({
        telegramChatId: telegramId,
        nombreTelegram: fullName,
      });
      await this.clientesRepository.save(client);
    }

    await ctx.reply(
      `Hola ${client.nombreTelegram || 'Cliente'}. ` +
        `He recibido tu mensaje. Un administrador se pondrá en contacto contigo pronto.`,
    );
  }
}
