import { Injectable } from '@nestjs/common';
import { CreateTelegramConversationDto } from './dto/create-telegram-conversation.dto';
import { UpdateTelegramConversationDto } from './dto/update-telegram-conversation.dto';

@Injectable()
export class TelegramConversationsService {
  create(createTelegramConversationDto: CreateTelegramConversationDto) {
    return 'This action adds a new telegramConversation';
  }

  findAll() {
    return `This action returns all telegramConversations`;
  }

  findOne(id: number) {
    return `This action returns a #${id} telegramConversation`;
  }

  update(
    id: number,
    updateTelegramConversationDto: UpdateTelegramConversationDto,
  ) {
    return `This action updates a #${id} telegramConversation`;
  }

  remove(id: number) {
    return `This action removes a #${id} telegramConversation`;
  }
}
