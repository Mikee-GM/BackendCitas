import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ClientsModule } from '../clients/clients.module';
import { Clientes } from '../clients/entities/client.entity';
import { TelegramModule } from '../telegram/telegram.module';
import { Servicios } from '../services/entities/service.entity';
import { ClientMembership } from '../loyalty/entities/client-membership.entity';
import { PromotionCampaign } from './entities/promotion.entity';
import { PromotionDelivery } from './entities/promotion-delivery.entity';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';
import { TextGenerationService } from './text-generation.service';
@Module({ imports: [AuthModule, ClientsModule, TelegramModule, TypeOrmModule.forFeature([Clientes, PromotionCampaign, PromotionDelivery, Servicios, ClientMembership])], controllers: [PromotionsController], providers: [PromotionsService, TextGenerationService] })
export class PromotionsModule {}
