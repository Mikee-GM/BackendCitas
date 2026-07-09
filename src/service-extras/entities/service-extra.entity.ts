import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({ description: 'Id', example: '00000000-0000-4000-8000-000000000000' })
  id: string;

  @Column('uuid', { name: 'servicio_id' })
  @ApiProperty({ description: 'Servicio Id', example: '00000000-0000-4000-8000-000000000000' })
  servicioId: string;

  @Column('uuid', { name: 'extra_catalogo_id' })
  @ApiProperty({ description: 'Extra Catalogo Id', example: '00000000-0000-4000-8000-000000000000' })
  extraCatalogoId: string;

  @Column('numeric', { name: 'precio_cobrado', precision: 10, scale: 2 })
  @ApiProperty({ description: 'Precio Cobrado', example: '1200.00' })
  precioCobrado: string;

  @Column('enum', { name: 'metodo_pago', enum: ['tarjeta', 'transferencia'] })
  @ApiProperty({ description: 'Metodo Pago', enum: ['tarjeta', 'transferencia'], example: 'tarjeta' })
  metodoPago: 'tarjeta' | 'transferencia';

  @Column('timestamp with time zone', {
    name: 'registrado_at',
    default: () => 'now()',
  })
  @ApiProperty({ description: 'Registrado At', type: String, format: 'date-time', example: '2026-07-09T12:00:00.000Z' })
  registradoAt: Date;

  @ManyToOne(
    () => ExtrasCatalogo,
    (extrasCatalogo) => extrasCatalogo.extrasServicios,
    { onDelete: 'RESTRICT' },
  )
  @JoinColumn([{ name: 'extra_catalogo_id', referencedColumnName: 'id' }])
  @ApiProperty({ description: 'Extra Catalogo', type: () => ExtrasCatalogo })
  extraCatalogo: ExtrasCatalogo;

  @ManyToOne(() => Usuarios, (usuarios) => usuarios.extrasServicios, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn([{ name: 'registrado_por', referencedColumnName: 'id' }])
  @ApiProperty({ description: 'Registrado Por', type: () => Usuarios })
  registradoPor: Usuarios;

  @ManyToOne(() => Servicios, (servicios) => servicios.extrasServicios, {
    onDelete: 'CASCADE',
  })
  @JoinColumn([{ name: 'servicio_id', referencedColumnName: 'id' }])
  @ApiProperty({ description: 'Servicio', type: () => Servicios })
  servicio: Servicios;
}
