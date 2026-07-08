import { Column, Entity, Index, OneToMany } from 'typeorm';
import { ClientMembership } from './client-membership.entity';

@Index('loyalty_tiers_code_key', ['code'], { unique: true })
@Index('idx_loyalty_tiers_active_min_spend', ['active', 'minSpend'])
@Entity('loyalty_tiers', { schema: 'public' })
export class LoyaltyTier {
  @Column('uuid', {
    primary: true,
    name: 'id',
    default: () => 'gen_random_uuid()',
  })
  id: string;

  @Column('character varying', { name: 'code', unique: true, length: 50 })
  code: string;

  @Column('character varying', { name: 'name', length: 120 })
  name: string;

  @Column('numeric', {
    name: 'min_spend',
    precision: 12,
    scale: 2,
    default: () => '0',
  })
  minSpend: string;

  @Column('numeric', {
    name: 'earn_rate',
    precision: 10,
    scale: 4,
    default: () => '0.1000',
  })
  earnRate: string;

  @Column('boolean', { name: 'active', default: () => 'true' })
  active: boolean;

  @Column('integer', { name: 'sort_order', default: () => '0' })
  sortOrder: number;

  @Column('timestamp with time zone', {
    name: 'created_at',
    default: () => 'now()',
  })
  createdAt: Date;

  @Column('timestamp with time zone', {
    name: 'updated_at',
    default: () => 'now()',
  })
  updatedAt: Date;

  @OneToMany(() => ClientMembership, (membership) => membership.tier)
  memberships: ClientMembership[];
}
