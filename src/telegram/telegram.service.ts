import { Injectable } from "@nestjs/common";
import { InjectBot } from "nestjs-telegraf";
import { Telegraf, Context } from "telegraf";

@Injectable()
export class TelegramService {
  constructor(@InjectBot() private readonly bot: Telegraf<Context>) {}

  /**
   * Envia un mensaje programático a un usuario por su ID de Telegram.
   * @param telegramId El ID de Telegram del usuario (como string bigint).
   * @param message El mensaje a enviar.
   */
  async sendMessage(telegramId: string, message: string): Promise<void> {
    await this.bot.telegram.sendMessage(telegramId, message);
  }
}
