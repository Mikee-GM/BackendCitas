import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { ExtrasCatalogo } from '../../catalog-extras/entities/catalog-extra.entity';
import { Usuarios } from '../../users/entities/user.entity';
import { Servicios } from '../../services/entities/service.entity';

@Index('idx_extras_servicio_catalogo', ['extraCatalogoId'], {})
@Index('extras_servicio_pkey', ['id'], { unique: true })
@Index('idx_extras_servicio_servicio', ['servicioId'], {})
@Entity('extras_servicio', { schema: 'public' })
export class ExtrasServicio {
  @Column('uuid', {
    primary: true,
    name: 'id',
    default: () => 'gen_random_uuid()',
  })
  id: string;

  @Column('uuid', { name: 'servicio_id' })
  servicioId: string;

  @Column('uuid', { name: 'extra_catalogo_id' })
  extraCatalogoId: string;

  @Column('numeric', { name: 'precio_cobrado', precision: 10, scale: 2 })
  precioCobrado: string;

  @Column('enum', { name: 'metodo_pago', enum: ['tarjeta', 'transferencia'] })
  metodoPago: 'tarjeta' | 'transferencia';

  @Column('timestamp with time zone', {
    name: 'registrado_at',
    default: () => 'now()',
  })
  registradoAt: Date;

  @ManyToOne(
    () => ExtrasCatalogo,
    (extrasCatalogo) => extrasCatalogo.extrasServicios,
    { onDelete: 'RESTRICT' },
  )
  @JoinColumn([{ name: 'extra_catalogo_id', referencedColumnName: 'id' }])
  extraCatalogo: ExtrasCatalogo;

  @ManyToOne(() => Usuarios, (usuarios) => usuarios.extrasServicios, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn([{ name: 'registrado_por', referencedColumnName: 'id' }])
  registradoPor: Usuarios;

  @ManyToOne(() => Servicios, (servicios) => servicios.extrasServicios, {
    onDelete: 'CASCADE',
  })
  @JoinColumn([{ name: 'servicio_id', referencedColumnName: 'id' }])
  servicio: Servicios;
}
