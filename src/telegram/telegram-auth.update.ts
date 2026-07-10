import { Inject, forwardRef, Logger } from '@nestjs/common';
import { Update, Start, Help, Ctx, Action, Command } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { Usuarios } from '../users/entities/user.entity';
import { Clientes } from '../clients/entities/client.entity';
import { Empleadas } from '../employees/entities/employee.entity';
import { TelegramService } from './telegram.service';
import { TelegramBookingUpdate } from './telegram-booking.update';

@Update()
export class TelegramAuthUpdate {
  private readonly logger = new Logger(TelegramAuthUpdate.name);

  constructor(
    @InjectRepository(Usuarios)
    private readonly usuariosRepository: Repository<Usuarios>,
    @InjectRepository(Clientes)
    private readonly clientesRepository: Repository<Clientes>,
    @InjectRepository(Empleadas)
    private readonly empleadasRepository: Repository<Empleadas>,
    private readonly jwtService: JwtService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    @Inject(forwardRef(() => TelegramBookingUpdate))
    private readonly telegramBookingUpdate: TelegramBookingUpdate,
  ) {}

  @Start()
  @Command('contactar')
  async onStart(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    // Check if the user is a registered system user (employee, admin, etc.)
    const user = await this.usuariosRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    // Otherwise, check/register client
    let client: Clientes | null = null;
    if (!user) {
      client = await this.clientesRepository.findOne({
        where: { telegramChatId: telegramId },
      });

      if (!client) {
        const firstName = ctx.from?.first_name || '';
        const username = ctx.from?.username || '';
        const fullName =
          [firstName, ctx.from?.last_name].filter(Boolean).join(' ') ||
          username ||
          'Cliente';

        // Auto-register client
        client = this.clientesRepository.create({
          telegramChatId: telegramId,
          nombreTelegram: fullName,
        });
        await this.clientesRepository.save(client);
      }
    }

    // Interceptar deep link start para contratar (ej. /start contratar_ID o contratar_empleada_ID)
    const text = (ctx.message as any)?.text || '';
    const parts = text.split(' ');
    if (parts.length >= 2) {
      const payload = parts[1];
      if (payload.startsWith('contratar_')) {
        let empleadaId = payload.replace('contratar_', '');
        if (empleadaId.startsWith('empleada_')) {
          empleadaId = empleadaId.replace('empleada_', '');
        }
        await this.telegramBookingUpdate.startHireSession(ctx, empleadaId);
        return;
      }
    }

    if (user) {
      await ctx.reply(
        `¡Hola de nuevo! Estás autenticado como ${user.email} (Rol: ${user.rol.toUpperCase()}).\n` +
          `¿Qué deseas hacer hoy?`,
      );
      return;
    }

    const fullName = client?.nombreTelegram || 'Cliente';
    const webUrl = process.env.WEB_URL || 'https://tu-sitio-pasteleria.com';
    await ctx.reply(
      `¡Hola ${fullName}! Bienvenido.\n` +
        `Para contratar a una de nuestras empleadas y comenzar tu servicio, por favor utiliza el enlace de contratación directa en nuestra web.\n\n` +
        `🌐 *Visita nuestra web:* ${webUrl}`,
      {
        parse_mode: 'Markdown',
      },
    );
  }

  @Help()
  async onHelp(@Ctx() ctx: Context) {
    await ctx.reply(
      'Comandos disponibles:\n' +
        '/contactar - Iniciar interacción con el bot\n' +
        '/vincular <código> - Vincular cuenta de empleado o chofer\n' +
        '/desvincular - Desvincular tu cuenta de empleado o chofer\n' +
        '/vincular_grupo - Vincular el grupo de Telegram actual a tu cuenta (Jefes, Admins y Empleadas Independientes)\n' +
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
          'Por favor solicita un nuevo código en el panel.',
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
      `🎉 ¡Vinculación exitosa!\n` +
        `Tu cuenta con correo ${user.email} (Rol: ${user.rol.toUpperCase()}) ahora está vinculada a este Telegram.`,
    );

    if (user.rol === 'chofer' || user.rol === 'empleada') {
      await ctx.reply(
        `📍 Por favor, comparte tu ubicación en tiempo real utilizando el botón de abajo para poder recibir y gestionar servicios.`,
        Markup.keyboard([
          [Markup.button.locationRequest('📍 Compartir mi Ubicación')],
        ])
          .resize()
          .oneTime(),
      );
    }

    if (user.rol === 'chofer') {
      const driversGroupId = process.env.TELEGRAM_DRIVERS_GROUP_ID;
      if (driversGroupId) {
        try {
          const invite = await ctx.telegram.createChatInviteLink(
            driversGroupId,
            {
              member_limit: 1,
              expire_date: Math.floor(Date.now() / 1000) + 3600, // Expire in 1 hour
            },
          );
          await ctx.reply(
            `🚗 *Grupo de Choferes:*\n\n` +
              `Por favor únete al grupo oficial de choferes usando el siguiente enlace de un solo uso:\n` +
              `👉 ${invite.invite_link}`,
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

  @Command('vincular_grupo')
  async onVincularGrupo(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const user = await this.usuariosRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    if (!user) {
      await ctx.reply(
        '❌ No estás registrado o vinculado en el sistema. Vincula tu cuenta personal primero con /vincular <codigo> en el chat privado.',
      );
      return;
    }

    // Permitir jefe, admin o empleada (si es independiente)
    let isAllowed = user.rol === 'jefe' || user.rol === 'admin';
    if (user.rol === 'empleada') {
      const emp = await this.empleadasRepository.findOne({
        where: { usuarioId: user.id },
      });
      if (emp && emp.tipo === 'independiente') {
        isAllowed = true;
      }
    }

    if (!isAllowed) {
      await ctx.reply(
        '❌ Solo los Jefes, Administradores o Empleadas Independientes pueden vincular grupos.',
      );
      return;
    }

    const chatType = ctx.chat?.type;
    const chatId = ctx.chat?.id.toString();
    if (!chatId || (chatType !== 'group' && chatType !== 'supergroup')) {
      await ctx.reply(
        '❌ Este comando debe ejecutarse dentro del grupo de Telegram que deseas vincular.',
      );
      return;
    }

    user.grupoTelegramId = chatId;
    await this.usuariosRepository.save(user);

    await ctx.reply(
      `✅ ¡Grupo vinculado con éxito! ID del grupo registrado: ${chatId} para el usuario ${user.email}`,
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
}
