import { Update, Start, Help, On, Ctx, Action } from "nestjs-telegraf";
import { Context, Markup } from "telegraf";

@Update()
export class TelegramUpdate {
  @Start()
  async onStart(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    const username = ctx.from?.username || "";
    const firstName = ctx.from?.first_name || "";

    await ctx.reply(
      `¡Hola ${firstName}! Bienvenido al sistema de pastelería.\n` +
        `Tu ID de Telegram registrado es: ${telegramId} ${username}\n\n` +
        `¿Qué deseas hacer hoy?`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("🎂 Ver Menú", "ver_menu"),
          Markup.button.callback("📖 Ver Ayuda", "ver_ayuda"),
        ],
        [
          Markup.button.url(
            "🌐 Visitar Web",
            "https://tu-sitio-pasteleria.com",
          ),
        ],
      ]),
    );
  }

  @Help()
  async onHelp(@Ctx() ctx: Context) {
    await ctx.reply(
      "Comandos disponibles:\n" +
        "/start - Iniciar interacción con el bot\n" +
        "/help - Ver los comandos de ayuda",
    );
  }

  @Action("ver_menu")
  async onVerMenu(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await ctx.reply(
      "Aquí tienes nuestro menú de pasteles:\n" +
        "1. Tres Leches 🍰\n" +
        "2. Selva Negra 🍫\n" +
        "3. Tarta de Fresa 🍓",
    );
  }

  @Action("ver_ayuda")
  async onVerAyuda(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await ctx.reply(
      "Puedes usar /start para ver el menú principal o contactarnos directamente.",
    );
  }

  @On("text")
  async onMessage(@Ctx() ctx: Context) {
    await ctx.reply("He recibido tu mensaje. Estamos procesando tu solicitud.");
  }
}
