import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PromotionCampaign } from './promotion.entity';

@Entity('promotion_deliveries')
@Index(['campaignId', 'clientId'], { unique: true })
export class PromotionDelivery {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'campaign_id' }) campaignId: string;
  @Column('uuid', { name: 'client_id' }) clientId: string;
  @Column('text') message: string;
  @Column('varchar', { length: 20, default: 'queued' })
  status: 'queued' | 'sent' | 'failed';
  @Column('text', { nullable: true }) error: string | null;
  @Column('timestamp with time zone', { name: 'sent_at', nullable: true })
  sentAt: Date | null;

  @ManyToOne(() => PromotionCampaign, (campaign) => campaign.deliveries, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'campaign_id' }) campaign: PromotionCampaign;
}
