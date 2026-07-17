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
import { ConversacionesTelegram } from './entities/telegram-conversation.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  ApiControllerDocs,
  ApiCreateDocs,
  ApiFindAllDocs,
  ApiFindOneDocs,
  ApiRemoveDocs,
  ApiUpdateDocs,
} from '../common/swagger/api-docs.decorators';

@Controller('telegram-conversations')
@ApiControllerDocs('telegram-conversations', true)
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'jefe')
export class TelegramConversationsController {
  constructor(
    private readonly telegramConversationsService: TelegramConversationsService,
  ) {}

  @Post()
  @ApiCreateDocs({
    tag: 'telegram-conversations',
    entity: ConversacionesTelegram,
    createDto: CreateTelegramConversationDto,
    protected: true,
  })
  create(@Body() createTelegramConversationDto: CreateTelegramConversationDto) {
    return this.telegramConversationsService.create(
      createTelegramConversationDto,
    );
  }

  @Get()
  @ApiFindAllDocs({
    tag: 'telegram-conversations',
    entity: ConversacionesTelegram,
    protected: true,
  })
  findAll() {
    return this.telegramConversationsService.findAll();
  }

  @Get(':id')
  @ApiFindOneDocs({
    tag: 'telegram-conversations',
    entity: ConversacionesTelegram,
    protected: true,
  })
  findOne(@Param('id') id: string) {
    return this.telegramConversationsService.findOne(+id);
  }

  @Patch(':id')
  @ApiUpdateDocs({
    tag: 'telegram-conversations',
    entity: ConversacionesTelegram,
    updateDto: UpdateTelegramConversationDto,
    protected: true,
  })
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
  @ApiRemoveDocs({ tag: 'telegram-conversations', protected: true })
  remove(@Param('id') id: string) {
    return this.telegramConversationsService.remove(+id);
  }
}
