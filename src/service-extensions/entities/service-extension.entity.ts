import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Servicios } from '../../services/entities/service.entity';

@Index('extensiones_servicio_pkey', ['id'], { unique: true })
@Index('idx_extensiones_servicio_servicio', ['servicioId'], {})
@Entity('extensiones_servicio', { schema: 'public' })
export class ExtensionesServicio {
  @Column('uuid', {
    primary: true,
    name: 'id',
    default: () => 'gen_random_uuid()',
  })
  id: string;

  @Column('uuid', { name: 'servicio_id' })
  servicioId: string;

  @Column('numeric', { name: 'horas_agregadas', precision: 4, scale: 2 })
  horasAgregadas: string;

  @Column('numeric', { name: 'monto_agregado', precision: 10, scale: 2 })
  montoAgregado: string;

  @Column('enum', { name: 'aceptada_por', enum: ['cliente', 'empleada'] })
  aceptadaPor: 'cliente' | 'empleada';

  @Column('timestamp with time zone', {
    name: 'registrada_at',
    default: () => 'now()',
  })
  registradaAt: Date;

  @ManyToOne(() => Servicios, (servicios) => servicios.extensionesServicios, {
    onDelete: 'CASCADE',
  })
  @JoinColumn([{ name: 'servicio_id', referencedColumnName: 'id' }])
  servicio: Servicios;
}
