import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { Empleadas } from '../../employees/entities/employee.entity';
import { ExtrasServicio } from '../../service-extras/entities/service-extra.entity';

@Index('idx_extras_catalogo_empleada', ['empleadaId'], {})
@Index('extras_catalogo_empleada_id_nombre_key', ['empleadaId', 'nombre'], {
  unique: true,
})
@Index('extras_catalogo_pkey', ['id'], { unique: true })
@Entity('extras_catalogo', { schema: 'public' })
export class ExtrasCatalogo {
  @Column('uuid', {
    primary: true,
    name: 'id',
    default: () => 'gen_random_uuid()',
  })
  id: string;

  @Column('uuid', { name: 'empleada_id', unique: true })
  empleadaId: string;

  @Column('character varying', { name: 'nombre', unique: true, length: 150 })
  nombre: string;

  @Column('numeric', { name: 'precio', precision: 10, scale: 2 })
  precio: string;

  @Column('boolean', { name: 'activo', default: () => 'true' })
  activo: boolean;

  @Column('timestamp with time zone', {
    name: 'created_at',
    default: () => 'now()',
  })
  createdAt: Date;

  @ManyToOne(() => Empleadas, (empleadas) => empleadas.extrasCatalogos, {
    onDelete: 'CASCADE',
  })
  @JoinColumn([{ name: 'empleada_id', referencedColumnName: 'id' }])
  empleada: Empleadas;

  @OneToMany(
    () => ExtrasServicio,
    (extrasServicio) => extrasServicio.extraCatalogo,
  )
  extrasServicios: ExtrasServicio[];
}
