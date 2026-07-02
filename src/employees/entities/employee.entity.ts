import {
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { EmpleadaFotos } from '../../employee-photos/entities/employee-photo.entity';
import { Usuarios } from '../../users/entities/user.entity';
import { ExtrasCatalogo } from '../../catalog-extras/entities/catalog-extra.entity';
import { Servicios } from '../../services/entities/service.entity';

@Index('idx_empleadas_catalogo_activo', ['catalogoActivo'], {})
@Index('idx_empleadas_disponible', ['disponible'], {})
@Index('empleadas_pkey', ['id'], { unique: true })
@Index('empleadas_slug_catalogo_key', ['slugCatalogo'], { unique: true })
@Index('empleadas_usuario_id_key', ['usuarioId'], { unique: true })
@Entity('empleadas', { schema: 'public' })
export class Empleadas {
  @Column('uuid', {
    primary: true,
    name: 'id',
    default: () => 'gen_random_uuid()',
  })
  id: string;

  @Column('uuid', { name: 'usuario_id', unique: true })
  usuarioId: string;

  @Column('character varying', { name: 'nombre_real', length: 255 })
  nombreReal: string;

  @Column('character varying', { name: 'nombre_artistico', length: 255 })
  nombreArtistico: string;

  @Column('character varying', {
    name: 'slug_catalogo',
    unique: true,
    length: 100,
  })
  slugCatalogo: string;

  @Column('text', { name: 'foto_perfil_url', nullable: true })
  fotoPerfilUrl: string | null;

  @Column('text', { name: 'descripcion', nullable: true })
  descripcion: string | null;

  @Column('numeric', { name: 'precio_base_hora', precision: 10, scale: 2 })
  precioBaseHora: string;

  @Column('boolean', { name: 'disponible', default: () => 'false' })
  disponible: boolean;

  @Column('boolean', { name: 'catalogo_activo', default: () => 'true' })
  catalogoActivo: boolean;

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

  @Column('enum', {
    name: 'tipo',
    enum: ['independiente', 'agencia'],
    default: 'independiente',
  })
  tipo: 'independiente' | 'agencia';

  @OneToMany(() => EmpleadaFotos, (empleadaFotos) => empleadaFotos.empleada)
  empleadaFotos: EmpleadaFotos[];

  @OneToOne(() => Usuarios, (usuarios) => usuarios.empleadas, {
    onDelete: 'CASCADE',
  })
  @JoinColumn([{ name: 'usuario_id', referencedColumnName: 'id' }])
  usuario: Usuarios;

  @OneToMany(() => ExtrasCatalogo, (extrasCatalogo) => extrasCatalogo.empleada)
  extrasCatalogos: ExtrasCatalogo[];

  @OneToMany(() => Servicios, (servicios) => servicios.empleada)
  servicios: Servicios[];
}
