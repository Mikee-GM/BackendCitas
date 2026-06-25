import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Choferes } from '../../drivers/entities/driver.entity';
import { Servicios } from '../../services/entities/service.entity';

@Index('idx_viajes_chofer', ['choferId'], {})
@Index('idx_viajes_estado', ['estado'], {})
@Index('viajes_pkey', ['id'], { unique: true })
@Index('viajes_servicio_id_tipo_key', ['servicioId', 'tipo'], { unique: true })
@Index('idx_viajes_servicio', ['servicioId'], {})
@Entity('viajes', { schema: 'public' })
export class Viajes {
  @Column('uuid', {
    primary: true,
    name: 'id',
    default: () => 'gen_random_uuid()',
  })
  id: string;

  @Column('uuid', { name: 'servicio_id', unique: true })
  servicioId: string;

  @Column('uuid', { name: 'chofer_id' })
  choferId: string;

  @Column('enum', { name: 'tipo', unique: true, enum: ['ida', 'regreso'] })
  tipo: 'ida' | 'regreso';

  @Column('enum', {
    name: 'zona',
    enum: ['montecarlo', 'majestic', 'domicilio'],
  })
  zona: 'montecarlo' | 'majestic' | 'domicilio';

  @Column('numeric', { name: 'tarifa', precision: 10, scale: 2 })
  tarifa: string;

  @Column('enum', {
    name: 'estado',
    enum: [
      'notificado',
      'aceptado',
      'en_curso',
      'finalizado',
      'rechazado',
      'cancelado',
    ],
    default: 'notificado',
  })
  estado:
    | 'notificado'
    | 'aceptado'
    | 'en_curso'
    | 'finalizado'
    | 'rechazado'
    | 'cancelado';

  @Column('timestamp with time zone', {
    name: 'hora_notificacion',
    default: () => 'now()',
  })
  horaNotificacion: Date;

  @Column('timestamp with time zone', {
    name: 'hora_aceptacion',
    nullable: true,
  })
  horaAceptacion: Date | null;

  @Column('timestamp with time zone', {
    name: 'hora_inicio_viaje',
    nullable: true,
  })
  horaInicioViaje: Date | null;

  @Column('timestamp with time zone', {
    name: 'hora_fin_viaje',
    nullable: true,
  })
  horaFinViaje: Date | null;

  @ManyToOne(() => Choferes, (choferes) => choferes.viajes, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn([{ name: 'chofer_id', referencedColumnName: 'id' }])
  chofer: Choferes;

  @ManyToOne(() => Servicios, (servicios) => servicios.viajes, {
    onDelete: 'CASCADE',
  })
  @JoinColumn([{ name: 'servicio_id', referencedColumnName: 'id' }])
  servicio: Servicios;
}
