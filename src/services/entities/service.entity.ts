import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { AlertasClientes } from '../../client-alerts/entities/client-alert.entity';
import { ConversacionesTelegram } from '../../telegram-conversations/entities/telegram-conversation.entity';
import { ExtensionesServicio } from '../../service-extensions/entities/service-extension.entity';
import { ExtrasServicio } from '../../service-extras/entities/service-extra.entity';
import { Prorrogas } from '../../extensions/entities/extension.entity';
import { Clientes } from '../../clients/entities/client.entity';
import { Empleadas } from '../../employees/entities/employee.entity';
import { Usuarios } from '../../users/entities/user.entity';
import { Viajes } from '../../trips/entities/trip.entity';
import { LoyaltyTransaction } from '../../loyalty/entities/loyalty-transaction.entity';

@Index('idx_servicios_cliente', ['clienteId'], {})
@Index('idx_servicios_created_at', ['createdAt'], {})
@Index('idx_servicios_empleada', ['empleadaId'], {})
@Index('idx_servicios_estado', ['estado'], {})
@Index('servicios_pkey', ['id'], { unique: true })
@Index('idx_servicios_jefe', ['jefeId'], {})
@Entity('servicios', { schema: 'public' })
export class Servicios {
  @Column('uuid', {
    primary: true,
    name: 'id',
    default: () => 'gen_random_uuid()',
  })
  id: string;

  @Column('uuid', { name: 'empleada_id' })
  empleadaId: string;

  @Column('uuid', { name: 'cliente_id' })
  clienteId: string;

  @Column('uuid', { name: 'jefe_id' })
  jefeId: string;

  @Column('enum', {
    name: 'metodo_pago',
    enum: ['efectivo', 'tarjeta', 'transferencia'],
  })
  metodoPago: 'efectivo' | 'tarjeta' | 'transferencia';

  @Column('numeric', { name: 'duracion_pactada_horas', precision: 4, scale: 2 })
  duracionPactadaHoras: string;

  @Column('numeric', {
    name: 'duracion_final_horas',
    nullable: true,
    precision: 4,
    scale: 2,
  })
  duracionFinalHoras: string | null;

  @Column('numeric', { name: 'ubicacion_cliente_lat', precision: 10, scale: 7 })
  ubicacionClienteLat: string;

  @Column('numeric', { name: 'ubicacion_cliente_lng', precision: 10, scale: 7 })
  ubicacionClienteLng: string;

  @Column('numeric', {
    name: 'precio_base_hora_pactado',
    precision: 10,
    scale: 2,
  })
  precioBaseHoraPactado: string;

  @Column('numeric', {
    name: 'total_base',
    precision: 10,
    scale: 2,
    default: () => '0',
  })
  totalBase: string;

  @Column('numeric', {
    name: 'total_extras',
    precision: 10,
    scale: 2,
    default: () => '0',
  })
  totalExtras: string;

  @Column('numeric', {
    name: 'total_final',
    precision: 10,
    scale: 2,
    default: () => '0',
  })
  totalFinal: string;

  @Column('timestamp with time zone', {
    name: 'hora_inicio_servicio',
    nullable: true,
  })
  horaInicioServicio: Date | null;

  @Column('timestamp with time zone', {
    name: 'hora_fin_servicio',
    nullable: true,
  })
  horaFinServicio: Date | null;

  @Column('timestamp with time zone', {
    name: 'hora_llegada_casa',
    nullable: true,
  })
  horaLlegadaCasa: Date | null;

  @Column('smallint', { name: 'prorrogas_usadas', default: () => '0' })
  prorrogasUsadas: number;

  @Column('enum', {
    name: 'estado',
    enum: [
      'pendiente',
      'en_curso',
      'finalizado',
      'cancelado',
      'pendiente_encadenado',
    ],
    default: 'pendiente',
  })
  estado:
    | 'pendiente'
    | 'en_curso'
    | 'finalizado'
    | 'cancelado'
    | 'pendiente_encadenado';

  @Column('text', { name: 'notas', nullable: true })
  notas: string | null;

  @Column('varchar', { name: 'telegram_cliente_mensaje_id', nullable: true })
  telegramClienteMensajeId: string | null;

  @Column('varchar', { name: 'telegram_empleada_mensaje_id', nullable: true })
  telegramEmpleadaMensajeId: string | null;

  @Column('bigint', { name: 'cliente_telegram_id', nullable: true })
  clienteTelegramId: string | null;

  @Column('boolean', { name: 'ia_activa', default: true })
  iaActiva: boolean;

  @Column('bigint', { name: 'telegram_thread_id', nullable: true })
  telegramThreadId: string | null;

  @Column('integer', { name: 'calificacion', nullable: true })
  calificacion: number | null;

  @Column('text', { name: 'comentarios_calificacion', nullable: true })
  comentariosCalificacion: string | null;

  @Column('boolean', {
    name: 'notificacion_extension_enviada',
    default: false,
  })
  notificacionExtensionEnviada: boolean;

  /** ID del servicio que debe terminar antes de que este pueda iniciar (cita encadenada) */
  @Column('uuid', { name: 'servicio_previo_id', nullable: true })
  servicioPrevioId: string | null;

  /** Estimación dinámica de cuándo iniciará este servicio (actualizada por trigger al extenderse el previo) */
  @Column('timestamp with time zone', {
    name: 'hora_inicio_estimada',
    nullable: true,
  })
  horaInicioEstimada: Date | null;

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

  @OneToMany(
    () => AlertasClientes,
    (alertasClientes) => alertasClientes.servicio,
  )
  alertasClientes: AlertasClientes[];

  @OneToMany(
    () => ConversacionesTelegram,
    (conversacionesTelegram) => conversacionesTelegram.servicio,
  )
  conversacionesTelegrams: ConversacionesTelegram[];

  @OneToMany(
    () => ExtensionesServicio,
    (extensionesServicio) => extensionesServicio.servicio,
  )
  extensionesServicios: ExtensionesServicio[];

  @OneToMany(() => ExtrasServicio, (extrasServicio) => extrasServicio.servicio)
  extrasServicios: ExtrasServicio[];

  @OneToMany(() => Prorrogas, (prorrogas) => prorrogas.servicio)
  prorrogases: Prorrogas[];

  @ManyToOne(() => Clientes, (clientes) => clientes.servicios, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn([{ name: 'cliente_id', referencedColumnName: 'id' }])
  cliente: Clientes;

  @ManyToOne(() => Empleadas, (empleadas) => empleadas.servicios, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn([{ name: 'empleada_id', referencedColumnName: 'id' }])
  empleada: Empleadas;

  @ManyToOne(() => Usuarios, (usuarios) => usuarios.servicios, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn([{ name: 'jefe_id', referencedColumnName: 'id' }])
  jefe: Usuarios;

  @OneToMany(() => Viajes, (viajes) => viajes.servicio)
  viajes: Viajes[];

  @OneToMany(
    () => LoyaltyTransaction,
    (loyaltyTransaction) => loyaltyTransaction.servicio,
  )
  loyaltyTransactions: LoyaltyTransaction[];

  /** Servicio previo al que está encadenado este (si aplica) */
  @ManyToOne(() => Servicios, (s) => s.serviciosEncadenados, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn([{ name: 'servicio_previo_id', referencedColumnName: 'id' }])
  servicioPrevio: Servicios | null;

  /** Servicios que están en cola esperando que este termine */
  @OneToMany(() => Servicios, (s) => s.servicioPrevio)
  serviciosEncadenados: Servicios[];
}
