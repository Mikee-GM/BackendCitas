import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
} from 'typeorm';
import { Clientes } from '../../clients/entities/client.entity';
import { Usuarios } from '../../users/entities/user.entity';
import { LoyaltyTier } from './loyalty-tier.entity';

@Index('client_memberships_cliente_id_key', ['clienteId'], { unique: true })
@Index('idx_client_memberships_tier', ['tierId'])
@Entity('client_memberships', { schema: 'public' })
export class ClientMembership {
  @Column('uuid', {
    primary: true,
    name: 'id',
    default: () => 'gen_random_uuid()',
  })
  id: string;

  @Column('uuid', { name: 'cliente_id', unique: true })
  clienteId: string;

  @Column('uuid', { name: 'tier_id' })
  tierId: string;

  @Column('enum', {
    name: 'status',
    enum: ['active', 'inactive', 'suspended'],
    default: 'active',
  })
  status: 'active' | 'inactive' | 'suspended';

  @Column('enum', {
    name: 'assignment_type',
    enum: ['automatic', 'manual'],
    default: 'automatic',
  })
  assignmentType: 'automatic' | 'manual';

  @Column('integer', { name: 'points_balance', default: () => '0' })
  pointsBalance: number;

  @Column('integer', { name: 'lifetime_points', default: () => '0' })
  lifetimePoints: number;

  @Column('numeric', {
    name: 'lifetime_spend',
    precision: 12,
    scale: 2,
    default: () => '0',
  })
  lifetimeSpend: string;

  @Column('uuid', { name: 'assigned_by_user_id', nullable: true })
  assignedByUserId: string | null;

  @Column('text', { name: 'assignment_notes', nullable: true })
  assignmentNotes: string | null;

  @Column('timestamp with time zone', {
    name: 'joined_at',
    default: () => 'now()',
  })
  joinedAt: Date;

  @Column('timestamp with time zone', { name: 'assigned_at', nullable: true })
  assignedAt: Date | null;

  @Column('timestamp with time zone', {
    name: 'updated_at',
    default: () => 'now()',
  })
  updatedAt: Date;

  @OneToOne(() => Clientes, (cliente) => cliente.membership, {
    onDelete: 'CASCADE',
  })
  @JoinColumn([{ name: 'cliente_id', referencedColumnName: 'id' }])
  cliente: Clientes;

  @ManyToOne(() => LoyaltyTier, (tier) => tier.memberships, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn([{ name: 'tier_id', referencedColumnName: 'id' }])
  tier: LoyaltyTier;

  @ManyToOne(() => Usuarios, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn([{ name: 'assigned_by_user_id', referencedColumnName: 'id' }])
  assignedBy: Usuarios | null;
}
