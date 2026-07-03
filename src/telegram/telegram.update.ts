import { Inject, forwardRef } from '@nestjs/common';
import { Update, Start, Help, On, Ctx, Action, Command } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { RealtimeEventsService } from '../realtime/realtime.service';
import { Usuarios } from '../users/entities/user.entity';
import { Clientes } from '../clients/entities/client.entity';
import { Empleadas } from '../employees/entities/employee.entity';
import { Servicios } from '../services/entities/service.entity';
import { Viajes } from '../trips/entities/trip.entity';
import { Choferes } from '../drivers/entities/driver.entity';
import { ServicesService } from '../services/services.service';
import { TelegramService } from './telegram.service';

interface SessionData {
  step?: 'AWAITING_DURATION' | 'AWAITING_PAYMENT_METHOD' | 'AWAITING_LOCATION';
  empleadaId?: string;
  duracionPactadaHoras?: number;
  metodoPago?: 'efectivo' | 'tarjeta' | 'transferencia';
}

interface BotContext extends Context {
  session?: SessionData;
}

@Update()
export class TelegramUpdate {
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
    private readonly dataSource: DataSource,
    @Inject(forwardRef(() => ServicesService))
    private readonly servicesService: ServicesService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {}

  @Start()
  async onStart(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    // Check if the user is a registered system user (employee, admin, etc.)
    const user = await this.usuariosRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    if (user) {
      await ctx.reply(
        `¡Hola de nuevo! Estás autenticado como ${user.email} (Rol: ${user.rol.toUpperCase()}).\n` +
          `¿Qué deseas hacer hoy?`,
      );
      return;
    }

    // Otherwise, check/register client
    let client = await this.clientesRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    const firstName = ctx.from?.first_name || '';
    const username = ctx.from?.username || '';
    const fullName =
      [firstName, ctx.from?.last_name].filter(Boolean).join(' ') ||
      username ||
      'Cliente';

    if (!client) {
      // Auto-register client
      client = this.clientesRepository.create({
        telegramChatId: telegramId,
        nombreTelegram: fullName,
      });
      await this.clientesRepository.save(client);
    }

    await ctx.reply(
      `¡Hola ${fullName}! Bienvenido al sistema de pastelería.\n` +
        `Tu ID de Telegram registrado es: ${telegramId}\n\n` +
        `¿Qué deseas hacer hoy?`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('🎂 Ver Menú', 'ver_menu'),
          Markup.button.callback('👩‍🍳 Ver Empleadas', 'ver_empleadas'),
        ],
        [
          Markup.button.callback('📖 Ver Ayuda', 'ver_ayuda'),
          Markup.button.url(
            '🌐 Visitar Web',
            'https://tu-sitio-pasteleria.com',
          ),
        ],
      ]),
    );
  }

  @Help()
  async onHelp(@Ctx() ctx: Context) {
    await ctx.reply(
      'Comandos disponibles:\n' +
        '/start - Iniciar interacción con el bot\n' +
        '/empleadas - Ver el catálogo de empleadas\n' +
        '/vincular <código> - Vincular cuenta de empleado o chofer\n' +
        '/desvincular - Desvincular tu cuenta de empleado o chofer\n' +
        '/help - Ver los comandos de ayuda',
    );
  }

  @Command('vincular')
  async onVincular(@Ctx() ctx: Context) {
    const messageText = (ctx.message as { text?: string })?.text || '';
    const parts = messageText.split(' ');
    if (parts.length < 2) {
      await ctx.reply(
        'Por favor proporciona el código de vinculación.\n' +
          'Uso: /vincular <código_de_6_dígitos>',
      );
      return;
    }

    const code = parts[1].trim();
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    // Find the user with the active, non-expired OTP code
    const user = await this.usuariosRepository.findOne({
      where: {
        telegramVerificationCode: code,
        telegramVerificationExpiresAt: MoreThan(new Date()),
      },
    });

    if (!user) {
      await ctx.reply(
        'El código de vinculación no es válido o ha expirado. ' +
          'Por favor solicita un nuevo código desde el Panel de Administración.',
      );
      return;
    }

    // Check if this telegramId is already linked to another user
    const existingUser = await this.usuariosRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    if (existingUser) {
      await ctx.reply(
        `Este Telegram ya se encuentra vinculado a la cuenta ${existingUser.email}. ` +
          `No se puede vincular a otra cuenta.`,
      );
      return;
    }

    // Link account
    user.telegramChatId = telegramId;
    user.telegramVerificationCode = null;
    user.telegramVerificationExpiresAt = null;
    await this.usuariosRepository.save(user);

    await ctx.reply(
      `¡Vinculación exitosa!\n` +
        `Tu cuenta de Telegram ha sido asociada al usuario: ${user.email}\n` +
        `Rol: ${user.rol.toUpperCase()}\n` +
        `Ahora puedes interactuar con el bot para tus tareas laborales.`,
    );

    if (user.rol === 'chofer') {
      const driversGroupId = process.env.TELEGRAM_DRIVERS_GROUP_ID;
      if (driversGroupId) {
        try {
          const invite = await ctx.telegram.createChatInviteLink(
            driversGroupId,
            {
              member_limit: 1,
              expire_date: Math.floor(Date.now() / 1000) + 86400, // Expire in 1 day
            },
          );
          await ctx.reply(
            `🚗 *Grupo de Choferes:*\n` +
              `Por favor únete al canal de coordinación mediante este enlace de un solo uso:\n` +
              `\${invite.invite_link}`,
            { parse_mode: 'Markdown' },
          );
        } catch (err) {
          console.error('Error al generar invite link para el chofer:', err);
        }
      }
    }
  }

  @Command('desvincular')
  async onDesvincular(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const user = await this.usuariosRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    if (!user) {
      await ctx.reply(
        'No tienes ninguna cuenta de personal vinculada a este Telegram.',
      );
      return;
    }

    user.telegramChatId = null;
    user.telegramVerificationCode = null;
    user.telegramVerificationExpiresAt = null;
    await this.usuariosRepository.save(user);

    await ctx.reply(
      `Tu cuenta (${user.email}) ha sido desvinculada exitosamente de este Telegram.`,
    );
  }

  @Command('panel')
  async onPanel(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const user = await this.usuariosRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    if (!user || (user.rol !== 'jefe' && user.rol !== 'admin')) {
      await ctx.reply(
        '❌ No tienes permisos de Jefe o Administrador para acceder al panel.',
      );
      return;
    }

    const payload = { sub: user.id, email: user.email, rol: user.rol };
    const token = this.jwtService.sign(payload);

    await ctx.reply(
      `🔑 *Token de Acceso Jefes:*\n\n` +
        `\`${token}\`\n\n` +
        `Usa este token para autenticar tu panel externo conectándote al flujo de Server-Sent Events (SSE).`,
      { parse_mode: 'Markdown' },
    );
  }

  @Action('ver_menu')
  async onVerMenu(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await ctx.reply(
      'Aquí tienes nuestro menú de pasteles:\n' +
        '1. Tres Leches 🍰\n' +
        '2. Selva Negra 🍫\n' +
        '3. Tarta de Fresa 🍓',
    );
  }

  @Action('ver_ayuda')
  async onVerAyuda(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await ctx.reply(
      'Puedes usar /start para ver el menú principal, o vincular tu cuenta con /vincular <código> si eres personal.',
    );
  }

  async listEmpleadas(ctx: Context) {
    const list = await this.empleadasRepository.find({
      where: { catalogoActivo: true },
    });

    if (list.length === 0) {
      await ctx.reply(
        'No hay empleadas activas en el catálogo en este momento.',
      );
      return;
    }

    await ctx.reply('Catálogo de Empleadas:');

    for (const e of list) {
      const caption = `*${e.nombreArtistico}*\n💰 *Tarifa:* $${e.precioBaseHora}/hr`;
      const keyboard = Markup.inlineKeyboard([
        Markup.button.callback(
          '🔍 Ver Perfil Completo',
          `ver_empleada:${e.id}`,
        ),
      ]);

      const hasValidPhoto =
        e.fotoPerfilUrl &&
        (e.fotoPerfilUrl.startsWith('http://') ||
          e.fotoPerfilUrl.startsWith('https://'));

      if (hasValidPhoto) {
        try {
          await ctx.replyWithPhoto(e.fotoPerfilUrl!, {
            caption,
            parse_mode: 'Markdown',
            ...keyboard,
          });
        } catch (error) {
          // Fallback si falla la descarga de la imagen por Telegram
          await ctx.reply(caption, {
            parse_mode: 'Markdown',
            ...keyboard,
          });
        }
      } else {
        await ctx.reply(caption, {
          parse_mode: 'Markdown',
          ...keyboard,
        });
      }
    }
  }

  @Command('empleadas')
  async onCommandEmpleadas(@Ctx() ctx: Context) {
    await this.listEmpleadas(ctx);
  }

  @Action('ver_empleadas')
  async onActionVerEmpleadas(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await this.listEmpleadas(ctx);
  }

  @Action(/^ver_empleada:(.+)$/)
  async onVerEmpleado(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    const match = (ctx as any).match;
    if (!match) return;
    const id = match[1];

    const empleada = await this.empleadasRepository.findOne({
      where: { id },
      relations: { empleadaFotos: true },
    });

    if (!empleada) {
      await ctx.reply('La empleada seleccionada ya no está disponible.');
      return;
    }

    const status = empleada.disponible ? '🟢 Disponible' : '🔴 Ocupada';
    const caption =
      `*${empleada.nombreArtistico}*\n` +
      `Estado: ${status}\n` +
      `💰 *Tarifa:* $${empleada.precioBaseHora}/hr\n\n` +
      `_${empleada.descripcion || 'Sin descripción'}_`;

    const photos: string[] = [];
    if (
      empleada.fotoPerfilUrl &&
      (empleada.fotoPerfilUrl.startsWith('http://') ||
        empleada.fotoPerfilUrl.startsWith('https://'))
    ) {
      photos.push(empleada.fotoPerfilUrl);
    }
    if (empleada.empleadaFotos && empleada.empleadaFotos.length > 0) {
      empleada.empleadaFotos.forEach((f) => {
        if (
          f.url &&
          (f.url.startsWith('http://') || f.url.startsWith('https://'))
        ) {
          photos.push(f.url);
        }
      });
    }

    const hireKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(
          '🤝 Contratar',
          `contratar_empleada:${empleada.id}`,
        ),
      ],
    ]);

    if (photos.length > 0) {
      try {
        const mediaGroup = photos.map((url, index) => ({
          type: 'photo' as const,
          media: url,
          caption: index === 0 ? caption : undefined,
          parse_mode: 'Markdown' as const,
        }));

        await ctx.replyWithMediaGroup(mediaGroup);
        await ctx.reply('¿Deseas contratar a esta empleada?', hireKeyboard);
      } catch (error) {
        // Fallback si Telegram no puede descargar las imágenes (por ej. si apuntan a localhost)
        await ctx.reply(
          caption + '\n\n_(Nota: Las fotos no se pudieron cargar en Telegram)_',
          { parse_mode: 'Markdown', ...hireKeyboard },
        );
      }
    } else {
      await ctx.reply(caption, { parse_mode: 'Markdown', ...hireKeyboard });
    }
  }

  @Action(/^contratar_empleada:(.+)$/)
  async onContratarEmpleada(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    const match = (ctx as any).match;
    if (!match) return;
    const empleadaId = match[1];

    const empleada = await this.empleadasRepository.findOne({
      where: { id: empleadaId },
    });

    if (!empleada) {
      await ctx.reply('La empleada seleccionada ya no está disponible.');
      return;
    }

    if (!ctx.session) {
      ctx.session = {};
    }

    ctx.session.step = 'AWAITING_DURATION';
    ctx.session.empleadaId = empleadaId;

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

    await ctx.reply(
      `✅ Método de pago seleccionado: *${metodo.toUpperCase()}*.\n\n` +
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

    // Si no es personal, seguir el flujo de cliente para contratación
    if (ctx.session?.step !== 'AWAITING_LOCATION') {
      await ctx.reply(
        'Por favor, inicia la contratación de una empleada desde el catálogo primero.',
      );
      return;
    }

    const { empleadaId, duracionPactadaHoras, metodoPago } = ctx.session || {};

    if (!empleadaId || !duracionPactadaHoras || !metodoPago) {
      await ctx.reply(
        '❌ Datos incompletos del proceso. Por favor inicia nuevamente.',
      );
      if (ctx.session) {
        ctx.session = {};
      }
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
      const jefe = await this.usuariosRepository.findOne({
        where: [
          { rol: 'jefe', activo: true },
          { rol: 'admin', activo: true },
        ],
      });

      if (!jefe) {
        await ctx.reply(
          '❌ No hay ningún jefe o administrador activo asignado en el sistema en este momento para autorizar el servicio.',
        );
        return;
      }
      jefeId = jefe.id;
    }

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
    });

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

      // Enviar notificación a Telegram usando TelegramService
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

    await ctx.reply(msgExito, {
      parse_mode: 'Markdown',
      ...Markup.removeKeyboard(),
    });
  }

  @On('text')
  async onMessage(@Ctx() ctx: BotContext) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

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

  @Action(/^aceptar_viaje:(.+)$/)
  async onAceptarViaje(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const user = await this.usuariosRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    if (!user || user.rol !== 'chofer') {
      await ctx.answerCbQuery(
        '❌ Solo los choferes vinculados pueden tomar este viaje.',
        { show_alert: true },
      );
      return;
    }

    const chofer = await this.dataSource.getRepository(Choferes).findOne({
      where: { usuarioId: user.id },
    });

    if (!chofer) {
      await ctx.answerCbQuery(
        '❌ No se encontró tu perfil de chofer en el sistema.',
        { show_alert: true },
      );
      return;
    }

    const match = (ctx as any).match;
    const viajeId = match[1];

    const result = await this.dataSource.transaction(async (manager) => {
      const updateResult = await manager
        .createQueryBuilder()
        .update(Viajes)
        .set({
          choferId: chofer.id,
          estado: 'aceptado',
          horaAceptacion: new Date(),
        })
        .where('id = :viajeId AND "chofer_id" IS NULL', { viajeId })
        .execute();

      return updateResult.affected === 1;
    });

    if (result) {
      await ctx.answerCbQuery('✅ ¡Viaje asignado con éxito!', {
        show_alert: true,
      });

      const driverName = chofer.nombre;
      try {
        const messageText = (ctx.callbackQuery?.message as any)?.text || '';
        await ctx.editMessageText(
          messageText + `\n\n✅ *Viaje tomado por:* ${driverName}`,
          { parse_mode: 'Markdown' },
        );
      } catch (err) {
        console.error('Error al actualizar mensaje de grupo:', err);
      }

      const trip = await this.dataSource.getRepository(Viajes).findOne({
        where: { id: viajeId },
        relations: { servicio: { empleada: true, cliente: true } },
      });

      if (trip && trip.servicio) {
        this.realtimeEventsService.emitToDriver(chofer.id, {
          type: 'new_trip',
          data: trip,
        });

        this.realtimeEventsService.emitToEmployee(trip.servicio.empleadaId, {
          type: 'trip_accepted',
          data: {
            tripId: trip.id,
            choferName: driverName,
            serviceId: trip.servicio.id,
          },
        });

        this.realtimeEventsService.emitToJefes({
          type: 'trip_accepted',
          data: {
            tripId: trip.id,
            choferName: driverName,
            serviceId: trip.servicio.id,
          },
        });

        // Enviar información del viaje por privado al chofer
        if (user.telegramChatId) {
          const empLat = trip.servicio.empleada.ubicacionLat;
          const empLng = trip.servicio.empleada.ubicacionLng;
          let empLocationText = 'No registrada';
          const inlineButtons: any[][] = [];

          if (empLat && empLng) {
            empLocationText = `[Ver en Google Maps](https://www.google.com/maps/search/?api=1&query=${empLat},${empLng})`;
            inlineButtons.push([
              Markup.button.url(
                '🗺️ Google Maps',
                `https://www.google.com/maps/search/?api=1&query=${empLat},${empLng}`,
              ),
              Markup.button.url(
                '🚙 Waze',
                `https://waze.com/ul?ll=${empLat},${empLng}&navigate=yes`,
              ),
            ]);
          }

          inlineButtons.push([
            Markup.button.callback(
              '🙋‍♀️ Empleada Recogida',
              `chofer_recogida:${trip.id}`,
            ),
          ]);

          const privateMessageText =
            `🚗 *¡Viaje Tomado con Éxito!* 🚗\n\n` +
            `• *Empleada:* ${trip.servicio.empleada.nombreArtistico}\n` +
            `• *Cliente:* ${trip.servicio.cliente?.nombreTelegram || 'Desconocido'}\n` +
            `• *Ubicación de Recogida (Empleada):* ${empLocationText}\n\n` +
            `Por favor, presiona el botón de abajo una vez hayas recogido a la empleada.`;

          try {
            await ctx.telegram.sendMessage(
              user.telegramChatId,
              privateMessageText,
              {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(inlineButtons),
              },
            );
          } catch (sendErr) {
            console.error(
              'Error al enviar mensaje privado al chofer:',
              sendErr,
            );
          }
        }
      }
    } else {
      await ctx.answerCbQuery(
        '❌ Este viaje ya ha sido tomado por otro chofer.',
        { show_alert: true },
      );
    }
  }

  @Action(/^chofer_recogida:(.+)$/)
  async onChoferRecogida(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const user = await this.usuariosRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    if (!user || user.rol !== 'chofer') {
      await ctx.answerCbQuery(
        '❌ No tienes permisos para realizar esta acción.',
        { show_alert: true },
      );
      return;
    }

    const chofer = await this.dataSource.getRepository(Choferes).findOne({
      where: { usuarioId: user.id },
    });

    if (!chofer) {
      await ctx.answerCbQuery('❌ No se encontró tu perfil de chofer.', {
        show_alert: true,
      });
      return;
    }

    const match = (ctx as any).match;
    const viajeId = match[1];

    const trip = await this.dataSource.getRepository(Viajes).findOne({
      where: { id: viajeId },
      relations: { servicio: { cliente: true, empleada: true } },
    });

    if (!trip) {
      await ctx.answerCbQuery('❌ Viaje no encontrado.', { show_alert: true });
      return;
    }

    if (trip.choferId !== chofer.id) {
      await ctx.answerCbQuery('❌ Este viaje está asignado a otro chofer.', {
        show_alert: true,
      });
      return;
    }

    if (trip.estado !== 'aceptado') {
      await ctx.answerCbQuery(`❌ El viaje está en estado: ${trip.estado}`, {
        show_alert: true,
      });
      return;
    }

    // Actualizar el viaje a en_curso
    trip.estado = 'en_curso';
    trip.horaInicioViaje = new Date();
    await this.dataSource.getRepository(Viajes).save(trip);

    await ctx.answerCbQuery(
      '🟢 Pasajera a bordo. Iniciando trayecto al cliente.',
    );

    // Mostrar destino del cliente con botones de navegación
    const clientLat = trip.servicio.ubicacionClienteLat;
    const clientLng = trip.servicio.ubicacionClienteLng;
    let clientLocationText = 'No registrada';
    const inlineButtons: any[][] = [];

    if (clientLat && clientLng) {
      clientLocationText = `[Ver en Google Maps](https://www.google.com/maps/search/?api=1&query=${clientLat},${clientLng})`;
      inlineButtons.push([
        Markup.button.url(
          '🗺️ Google Maps',
          `https://www.google.com/maps/search/?api=1&query=${clientLat},${clientLng}`,
        ),
        Markup.button.url(
          '🚙 Waze',
          `https://waze.com/ul?ll=${clientLat},${clientLng}&navigate=yes`,
        ),
      ]);
    }

    inlineButtons.push([
      Markup.button.callback(
        '🏁 Finalizar Viaje',
        `chofer_finalizo_viaje:${trip.id}`,
      ),
    ]);

    const messageText =
      `🙋‍♀️ *¡Empleada Recogida con Éxito!* 🙋‍♀️\n\n` +
      `• *Empleada:* ${trip.servicio.empleada.nombreArtistico}\n` +
      `• *Cliente:* ${trip.servicio.cliente?.nombreTelegram || 'Desconocido'}\n` +
      `• *Ubicación del Cliente (Destino):* ${clientLocationText}\n\n` +
      `Por favor, presiona el botón de abajo una vez hayas llegado al destino final y finalizado el servicio.`;

    try {
      await ctx.editMessageText(messageText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(inlineButtons),
      });
    } catch (err) {
      console.error('Error actualizando mensaje de recogida:', err);
    }
  }

  @Action(/^chofer_finalizo_viaje:(.+)$/)
  async onChoferFinalizoViaje(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const user = await this.usuariosRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    if (!user || user.rol !== 'chofer') {
      await ctx.answerCbQuery(
        '❌ No tienes permisos para realizar esta acción.',
        { show_alert: true },
      );
      return;
    }

    const chofer = await this.dataSource.getRepository(Choferes).findOne({
      where: { usuarioId: user.id },
    });

    if (!chofer) {
      await ctx.answerCbQuery('❌ No se encontró tu perfil de chofer.', {
        show_alert: true,
      });
      return;
    }

    const match = (ctx as any).match;
    const viajeId = match[1];

    const trip = await this.dataSource.getRepository(Viajes).findOne({
      where: { id: viajeId },
      relations: { servicio: { empleada: true } },
    });

    if (!trip) {
      await ctx.answerCbQuery('❌ Viaje no encontrado.', { show_alert: true });
      return;
    }

    if (trip.choferId !== chofer.id) {
      await ctx.answerCbQuery('❌ Este viaje está asignado a otro chofer.', {
        show_alert: true,
      });
      return;
    }

    if (trip.estado !== 'en_curso') {
      await ctx.answerCbQuery(`❌ El viaje está en estado: ${trip.estado}`, {
        show_alert: true,
      });
      return;
    }

    // Actualizar el viaje a finalizado
    trip.estado = 'finalizado';
    trip.horaFinViaje = new Date();
    await this.dataSource.getRepository(Viajes).save(trip);

    await ctx.answerCbQuery('🏁 Viaje finalizado con éxito.');

    const messageText =
      `✅ *¡Viaje Finalizado!* 🏁\n\n` +
      `• *Empleada:* ${trip.servicio.empleada.nombreArtistico}\n` +
      `• *Hora Fin:* ${trip.horaFinViaje.toLocaleTimeString()}\n\n` +
      `¡Buen trabajo! El trayecto ha sido registrado en el sistema.`;

    try {
      await ctx.editMessageText(messageText, {
        parse_mode: 'Markdown',
      });
    } catch (err) {
      console.error('Error actualizando mensaje de finalización:', err);
    }
  }

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
      relations: { empleada: true },
    });

    if (!servicio) {
      await ctx.answerCbQuery('❌ Servicio no encontrado.', {
        show_alert: true,
      });
      return;
    }

    const isIndependentEmployee =
      servicio.empleada &&
      servicio.empleada.tipo === 'independiente' &&
      servicio.empleada.usuarioId === user.id;

    if (user.rol !== 'jefe' && user.rol !== 'admin' && !isIndependentEmployee) {
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
        await ctx.answerCbQuery('🔴 Servicio Rechazado.');
      }

      const originalText = (ctx.callbackQuery?.message as any)?.text || '';
      const statusLabel = accept ? '🟢 ACEPTADO' : '🔴 RECHAZADO';
      await ctx.editMessageText(
        originalText + `\n\n📢 *Resolución:* ${statusLabel} por ${user.email}`,
        { parse_mode: 'Markdown' },
      );
    } catch (err: any) {
      console.error('Error al autorizar servicio desde Telegram:', err);
      await ctx.answerCbQuery(
        err.message || 'Error al procesar la solicitud.',
        { show_alert: true },
      );
    }
  }
}
