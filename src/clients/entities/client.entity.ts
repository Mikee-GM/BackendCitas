import { Column, Entity, Index, OneToMany, OneToOne } from 'typeorm';
import { AlertasClientes } from '../../client-alerts/entities/client-alert.entity';
import { ConversacionesTelegram } from '../../telegram-conversations/entities/telegram-conversation.entity';
import { Servicios } from '../../services/entities/service.entity';
import { ClientMembership } from '../../loyalty/entities/client-membership.entity';
import { LoyaltyTransaction } from '../../loyalty/entities/loyalty-transaction.entity';

@Index('clientes_pkey', ['id'], { unique: true })
@Index('clientes_telegram_chat_id_key', ['telegramChatId'], { unique: true })
@Entity('clientes', { schema: 'public' })
export class Clientes {
  @Column('uuid', {
    primary: true,
    name: 'id',
    default: () => 'gen_random_uuid()',
  })
  id: string;

  @Column('bigint', { name: 'telegram_chat_id', unique: true })
  telegramChatId: string;

  @Column('character varying', {
    name: 'nombre_telegram',
    nullable: true,
    length: 255,
  })
  nombreTelegram: string | null;

  @Column('timestamp with time zone', {
    name: 'created_at',
    default: () => 'now()',
  })
  createdAt: Date;

  @Column('timestamp with time zone', {
    name: 'primer_contacto_at',
    default: () => 'now()',
  })
  primerContactoAt: Date;

  @OneToMany(
    () => AlertasClientes,
    (alertasClientes) => alertasClientes.cliente,
  )
  alertasClientes: AlertasClientes[];

  @OneToMany(
    () => ConversacionesTelegram,
    (conversacionesTelegram) => conversacionesTelegram.cliente,
  )
  conversacionesTelegrams: ConversacionesTelegram[];

  @OneToMany(() => Servicios, (servicios) => servicios.cliente)
  servicios: Servicios[];

  @OneToMany(
    () => LoyaltyTransaction,
    (loyaltyTransaction) => loyaltyTransaction.cliente,
  )
  loyaltyTransactions: LoyaltyTransaction[];

  @OneToOne(() => ClientMembership, (membership) => membership.cliente)
  membership: ClientMembership;
}
