import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { TelegramConversationsService } from './telegram-conversations.service';
import { CreateTelegramConversationDto } from './dto/create-telegram-conversation.dto';
import { UpdateTelegramConversationDto } from './dto/update-telegram-conversation.dto';

@Controller('telegram-conversations')
export class TelegramConversationsController {
  constructor(private readonly telegramConversationsService: TelegramConversationsService) {}

  @Post()
  create(@Body() createTelegramConversationDto: CreateTelegramConversationDto) {
    return this.telegramConversationsService.create(createTelegramConversationDto);
  }

  @Get()
  findAll() {
    return this.telegramConversationsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.telegramConversationsService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateTelegramConversationDto: UpdateTelegramConversationDto) {
    return this.telegramConversationsService.update(+id, updateTelegramConversationDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.telegramConversationsService.remove(+id);
  }
}
