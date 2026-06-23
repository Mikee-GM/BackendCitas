import { Update, Start, Help, On, Ctx, Action, Command } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Usuarios } from '../users/entities/user.entity';
import { Clientes } from '../clients/entities/client.entity';

@Update()
export class TelegramUpdate {
  constructor(
    @InjectRepository(Usuarios)
    private readonly usuariosRepository: Repository<Usuarios>,
    @InjectRepository(Clientes)
    private readonly clientesRepository: Repository<Clientes>,
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
          Markup.button.callback('📖 Ver Ayuda', 'ver_ayuda'),
        ],
        [
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

  @On('text')
  async onMessage(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    // Check who is messaging
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

    // Check if client is registered (auto-register just in case they skipped start)
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
