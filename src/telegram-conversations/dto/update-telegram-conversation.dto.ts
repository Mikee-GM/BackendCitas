import { PartialType } from '@nestjs/mapped-types';
import { CreateTelegramConversationDto } from './create-telegram-conversation.dto';

export class UpdateTelegramConversationDto extends PartialType(CreateTelegramConversationDto) {}
