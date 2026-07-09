import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Empleadas } from '../../employees/entities/employee.entity';

@Index('empleada_fotos_empleada_id_orden_key', ['empleadaId', 'orden'], {
  unique: true,
})
@Index('idx_empleada_fotos_empleada', ['empleadaId'], {})
@Index('empleada_fotos_pkey', ['id'], { unique: true })
@Entity('empleada_fotos', { schema: 'public' })
export class EmpleadaFotos {
  @Column('uuid', {
    primary: true,
    name: 'id',
    default: () => 'gen_random_uuid()',
  })
  id: string;

  @Column('uuid', { name: 'empleada_id' })
  empleadaId: string;

  @Column('text', { name: 'url' })
  url: string;

  @Column('smallint', { name: 'orden', default: () => '0' })
  orden: number;

  @Column('timestamp with time zone', {
    name: 'created_at',
    default: () => 'now()',
  })
  createdAt: Date;

  @ManyToOne(() => Empleadas, (empleadas) => empleadas.empleadaFotos, {
    onDelete: 'CASCADE',
  })
  @JoinColumn([{ name: 'empleada_id', referencedColumnName: 'id' }])
  empleada: Empleadas;
}
