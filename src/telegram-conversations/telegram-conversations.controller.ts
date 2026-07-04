import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { TelegramConversationsService } from './telegram-conversations.service';
import { CreateTelegramConversationDto } from './dto/create-telegram-conversation.dto';
import { UpdateTelegramConversationDto } from './dto/update-telegram-conversation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('telegram-conversations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'jefe')
export class TelegramConversationsController {
  constructor(
    private readonly telegramConversationsService: TelegramConversationsService,
  ) {}

  @Post()
  create(@Body() createTelegramConversationDto: CreateTelegramConversationDto) {
    return this.telegramConversationsService.create(
      createTelegramConversationDto,
    );
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
  update(
    @Param('id') id: string,
    @Body() updateTelegramConversationDto: UpdateTelegramConversationDto,
  ) {
    return this.telegramConversationsService.update(
      +id,
      updateTelegramConversationDto,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.telegramConversationsService.remove(+id);
  }
}
