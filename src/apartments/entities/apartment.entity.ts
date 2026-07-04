import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Empleadas } from '../../employees/entities/employee.entity';

@Entity('apartments', { schema: 'public' })
export class Apartments {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column('character varying', { name: 'nombre', length: 255 })
  nombre: string;

  @Column('text', { name: 'direccion', nullable: true })
  direccion: string | null;

  @Column('text', { name: 'descripcion', nullable: true })
  descripcion: string | null;

  @Column('numeric', {
    name: 'ubicacion_lat',
    nullable: true,
    precision: 10,
    scale: 7,
  })
  ubicacionLat: string | null;

  @Column('numeric', {
    name: 'ubicacion_lng',
    nullable: true,
    precision: 10,
    scale: 7,
  })
  ubicacionLng: string | null;

  @Column('timestamp with time zone', {
    name: 'created_at',
    default: () => 'now()',
  })
  createdAt: Date;

  @OneToMany(() => Empleadas, (empleadas) => empleadas.apartment)
  empleadas: Empleadas[];
}
