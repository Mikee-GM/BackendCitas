import { Module } from '@nestjs/common';
import { TelegramConversationsService } from './telegram-conversations.service';
import { TelegramConversationsController } from './telegram-conversations.controller';

@Module({
  controllers: [TelegramConversationsController],
  providers: [TelegramConversationsService],
})
export class TelegramConversationsModule {}
