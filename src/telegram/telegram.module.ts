import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TelegrafModule } from "nestjs-telegraf";
import { TelegramService } from "./telegram.service";
import { TelegramUpdate } from "./telegram.update";

@Module({
  imports: [
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const token = configService.get<string>("TELEGRAM_BOT_TOKEN");
        if (!token) {
          throw new Error(
            "TELEGRAM_BOT_TOKEN is not defined in environment variables",
          );
        }
        return { token };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [TelegramService, TelegramUpdate],
  exports: [TelegramService],
})
export class TelegramModule {}
