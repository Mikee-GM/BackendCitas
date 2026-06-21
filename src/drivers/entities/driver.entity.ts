import {
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { Usuarios } from '../../users/entities/user.entity';
import { Viajes } from '../../trips/entities/trip.entity';

@Index('idx_choferes_disponible', ['disponible'], {})
@Index('choferes_pkey', ['id'], { unique: true })
@Index('choferes_usuario_id_key', ['usuarioId'], { unique: true })
@Entity('choferes', { schema: 'public' })
export class Choferes {
  @Column('uuid', {
    primary: true,
    name: 'id',
    default: () => 'gen_random_uuid()',
  })
  id: string;

  @Column('uuid', { name: 'usuario_id', unique: true })
  usuarioId: string;

  @Column('character varying', { name: 'nombre', length: 255 })
  nombre: string;

  @Column('character varying', { name: 'telefono', length: 30 })
  telefono: string;

  @Column('boolean', { name: 'disponible', default: () => 'false' })
  disponible: boolean;

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
    name: 'ultima_ubicacion_at',
    nullable: true,
  })
  ultimaUbicacionAt: Date | null;

  @Column('timestamp with time zone', {
    name: 'created_at',
    default: () => 'now()',
  })
  createdAt: Date;

  @OneToOne(() => Usuarios, (usuarios) => usuarios.choferes, {
    onDelete: 'CASCADE',
  })
  @JoinColumn([{ name: 'usuario_id', referencedColumnName: 'id' }])
  usuario: Usuarios;

  @OneToMany(() => Viajes, (viajes) => viajes.chofer)
  viajes: Viajes[];
}
