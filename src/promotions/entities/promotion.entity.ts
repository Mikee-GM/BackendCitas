import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { PromotionTone } from '../dto/promotion.dto';
import { PromotionDelivery } from './promotion-delivery.entity';

@Entity('promotion_campaigns')
@Index(['fingerprint'], { unique: true })
export class PromotionCampaign {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('text') offer: string;
  @Column('varchar', { length: 80, default: 'coqueta' }) tone: PromotionTone;
  @Column('jsonb', { default: {} }) filters: Record<string, unknown>;
  @Column('uuid', { name: 'created_by_user_id' }) createdByUserId: string;
  @Column('varchar', { length: 64 }) fingerprint: string;
  @Column('int', { default: 0 }) matched: number;
  @Column('int', { default: 0 }) queued: number;
  @Column('timestamp with time zone', {
    name: 'created_at',
    default: () => 'now()',
  })
  createdAt: Date;

  @OneToMany(() => PromotionDelivery, (delivery) => delivery.campaign)
  deliveries: PromotionDelivery[];
}
