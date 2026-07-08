import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Clientes } from '../../clients/entities/client.entity';
import { Servicios } from '../../services/entities/service.entity';
import { Usuarios } from '../../users/entities/user.entity';

@Index('idx_loyalty_transactions_cliente', ['clienteId'])
@Index('idx_loyalty_transactions_servicio', ['servicioId'])
@Index('idx_loyalty_transactions_created_at', ['createdAt'])
@Index('loyalty_transactions_service_type_key', ['servicioId', 'type'], {
  unique: true,
})
@Entity('loyalty_transactions', { schema: 'public' })
export class LoyaltyTransaction {
  @Column('uuid', {
    primary: true,
    name: 'id',
    default: () => 'gen_random_uuid()',
  })
  id: string;

  @Column('uuid', { name: 'cliente_id' })
  clienteId: string;

  @Column('uuid', { name: 'servicio_id', nullable: true })
  servicioId: string | null;

  @Column('uuid', { name: 'created_by_user_id', nullable: true })
  createdByUserId: string | null;

  @Column('enum', {
    name: 'type',
    enum: ['earned', 'manual_adjustment', 'tier_assignment', 'reversal'],
  })
  type: 'earned' | 'manual_adjustment' | 'tier_assignment' | 'reversal';

  @Column('integer', { name: 'points' })
  points: number;

  @Column('numeric', {
    name: 'amount_basis',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  amountBasis: string | null;

  @Column('text', { name: 'description', nullable: true })
  description: string | null;

  @Column('timestamp with time zone', {
    name: 'created_at',
    default: () => 'now()',
  })
  createdAt: Date;

  @ManyToOne(() => Clientes, (cliente) => cliente.loyaltyTransactions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn([{ name: 'cliente_id', referencedColumnName: 'id' }])
  cliente: Clientes;

  @ManyToOne(() => Servicios, (servicio) => servicio.loyaltyTransactions, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn([{ name: 'servicio_id', referencedColumnName: 'id' }])
  servicio: Servicios | null;

  @ManyToOne(() => Usuarios, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn([{ name: 'created_by_user_id', referencedColumnName: 'id' }])
  createdBy: Usuarios | null;
}
