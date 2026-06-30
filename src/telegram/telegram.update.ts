import { Update, Start, Help, On, Ctx, Action, Command } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Usuarios } from '../users/entities/user.entity';
import { Clientes } from '../clients/entities/client.entity';
import { Empleadas } from '../employees/entities/employee.entity';
import { Servicios } from '../services/entities/service.entity';

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
        await ctx.reply(`📍 Ubicación actualizada correctamente para el chofer: ${user.choferes.nombre}`);
        return;
      }

      if (user.rol === 'empleada' && user.empleadas) {
        user.empleadas.ubicacionLat = lat;
        user.empleadas.ubicacionLng = lng;
        user.empleadas.ultimaUbicacionAt = new Date();
        await this.usuariosRepository.manager.save(user.empleadas);
        await ctx.reply(`📍 Ubicación actualizada correctamente para la empleada: ${user.empleadas.nombreArtistico}`);
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

    const nuevoServicio = this.serviciosRepository.create({
      clienteId: client.id,
      empleadaId: empleada.id,
      jefeId: jefe.id,
      duracionPactadaHoras: duracionPactadaHoras.toString(),
      metodoPago: metodoPago,
      ubicacionClienteLat: lat,
      ubicacionClienteLng: lng,
      precioBaseHoraPactado: empleada.precioBaseHora.toString(),
      estado: 'pendiente',
      notas: notasUbicacion,
    });

    await this.serviciosRepository.save(nuevoServicio);

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
}
