import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { Clientes } from '../clients/entities/client.entity';
import { Servicios } from '../services/entities/service.entity';
import { ClientMembership } from '../loyalty/entities/client-membership.entity';
import { TelegramService } from '../telegram/telegram.service';
import { Usuarios } from '../users/entities/user.entity';
import { PromotionCampaign } from './entities/promotion.entity';
import { PromotionDelivery } from './entities/promotion-delivery.entity';
import { PromotionRequestDto } from './dto/promotion.dto';
import { TextGenerationService } from './text-generation.service';

@Injectable()
export class PromotionsService {
  constructor(
    @InjectRepository(Clientes) private clients: Repository<Clientes>,
    @InjectRepository(Servicios) private services: Repository<Servicios>,
    @InjectRepository(ClientMembership)
    private memberships: Repository<ClientMembership>,
    @InjectRepository(PromotionCampaign)
    private campaigns: Repository<PromotionCampaign>,
    @InjectRepository(PromotionDelivery)
    private deliveries: Repository<PromotionDelivery>,
    private telegram: TelegramService,
    private ai: TextGenerationService,
  ) {}

  private async matching(dto: PromotionRequestDto) {
    const f = dto.filters || {};
    const qb = this.clients
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.membership', 'm')
      .leftJoinAndSelect('m.tier', 't')
      .where('c.telegram_chat_id IS NOT NULL');
    if (f.clientIds?.length)
      qb.andWhere('c.id IN (:...ids)', { ids: f.clientIds });
    if (f.membershipTierCodes?.length)
      qb.andWhere('t.code IN (:...tiers)', { tiers: f.membershipTierCodes });
    if (f.minPreviousServices !== undefined)
      qb.andWhere(
        '(SELECT COUNT(*) FROM servicios s WHERE s.cliente_id = c.id) >= :min',
        { min: f.minPreviousServices },
      );
    if (f.inactiveDays !== undefined)
      qb.andWhere(
        `((SELECT MAX(s.created_at) FROM servicios s WHERE s.cliente_id = c.id) <= NOW() - (:inactive || ' days')::interval OR NOT EXISTS (SELECT 1 FROM servicios s WHERE s.cliente_id = c.id))`,
        { inactive: f.inactiveDays },
      );
    if (f.excludePromotedWithinDays !== undefined)
      qb.andWhere(
        `NOT EXISTS (SELECT 1 FROM promotion_deliveries d JOIN promotion_campaigns p ON p.id = d.campaign_id WHERE d.client_id = c.id AND p.created_at >= NOW() - (:promoted || ' days')::interval)`,
        { promoted: f.excludePromotedWithinDays },
      );
    return qb.getMany();
  }
  async preview(dto: PromotionRequestDto) {
    const clients = await this.matching(dto);
    return {
      count: clients.length,
      sample: clients
        .slice(0, 10)
        .map((c) => ({
          id: c.id,
          name: c.nombreTelegram,
          telegramChatId: c.telegramChatId,
          membership: c.membership?.tier?.code || null,
        })),
    };
  }
  async send(dto: PromotionRequestDto, user: Usuarios) {
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          offer: dto.offer.trim(),
          tone: dto.tone || 'coqueta',
          filters: dto.filters || {},
        }),
      )
      .digest('hex');
    if (await this.campaigns.findOne({ where: { fingerprint } }))
      throw new ConflictException(
        'Esta campaña ya fue enviada o está registrada',
      );
    const clients = await this.matching(dto);
    const campaign = await this.campaigns.save(
      this.campaigns.create({
        offer: dto.offer.trim(),
        tone: dto.tone || 'coqueta',
        filters: (dto.filters || {}) as Record<string, unknown>,
        createdByUserId: user.id,
        fingerprint,
        matched: clients.length,
        queued: clients.length,
      }),
    );
    for (const client of clients) {
      const message = await this.ai.generate(
        campaign.offer,
        campaign.tone,
        client.nombreTelegram,
      );
      const delivery = await this.deliveries.save(
        this.deliveries.create({
          campaignId: campaign.id,
          clientId: client.id,
          message,
          status: 'queued',
        }),
      );
      try {
        await this.telegram.sendMessage(client.telegramChatId, message);
        delivery.status = 'sent';
        delivery.sentAt = new Date();
      } catch (error) {
        delivery.status = 'failed';
        delivery.error = error instanceof Error ? error.message : String(error);
      }
      await this.deliveries.save(delivery);
    }
    return {
      campaignId: campaign.id,
      matched: clients.length,
      queued: clients.length,
    };
  }
}
