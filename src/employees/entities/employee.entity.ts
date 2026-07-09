import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { EmpleadaFotos } from '../../employee-photos/entities/employee-photo.entity';
import { Usuarios } from '../../users/entities/user.entity';
import { ExtrasCatalogo } from '../../catalog-extras/entities/catalog-extra.entity';
import { Servicios } from '../../services/entities/service.entity';
import { Apartments } from '../../apartments/entities/apartment.entity';

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
  @ApiProperty({ description: 'Id', example: '00000000-0000-4000-8000-000000000000' })
  id: string;

  @Column('uuid', { name: 'usuario_id', unique: true })
  @ApiProperty({ description: 'Usuario Id', example: '00000000-0000-4000-8000-000000000000' })
  usuarioId: string;

  @Column('character varying', { name: 'nombre_real', length: 255 })
  @ApiProperty({ description: 'Nombre Real', example: 'Ejemplo' })
  nombreReal: string;

  @Column('character varying', { name: 'nombre_artistico', length: 255 })
  @ApiProperty({ description: 'Nombre Artistico', example: 'Ejemplo' })
  nombreArtistico: string;

  @Column('character varying', {
    name: 'slug_catalogo',
    unique: true,
    length: 100,
  })
  @ApiProperty({ description: 'Slug Catalogo', example: 'Ejemplo' })
  slugCatalogo: string;

  @Column('text', { name: 'foto_perfil_url', nullable: true })
  @ApiPropertyOptional({ description: 'Foto Perfil Url', example: 'https://example.com/recurso.jpg' })
  fotoPerfilUrl: string | null;

  @Column('text', { name: 'descripcion', nullable: true })
  @ApiPropertyOptional({ description: 'Descripcion', example: 'Ejemplo' })
  descripcion: string | null;

  @Column('character varying', { name: 'link_x', nullable: true, length: 255 })
  linkX: string | null;

  @Column('character varying', {
    name: 'contact_label',
    nullable: true,
    length: 100,
  })
  contactLabel: string | null;

  @Column('numeric', { name: 'precio_base_hora', precision: 10, scale: 2 })
  @ApiProperty({ description: 'Precio Base Hora', example: '1200.00' })
  precioBaseHora: string;

  @Column('boolean', { name: 'disponible', default: () => 'false' })
  @ApiProperty({ description: 'Disponible', example: true })
  disponible: boolean;

  @Column('boolean', { name: 'catalogo_activo', default: () => 'true' })
  @ApiProperty({ description: 'Catalogo Activo', example: true })
  catalogoActivo: boolean;

  @Column('numeric', {
    name: 'ubicacion_lat',
    nullable: true,
    precision: 10,
    scale: 7,
  })
  @ApiPropertyOptional({ description: 'Ubicacion Lat', example: '19.432608' })
  ubicacionLat: string | null;

  @Column('numeric', {
    name: 'ubicacion_lng',
    nullable: true,
    precision: 10,
    scale: 7,
  })
  @ApiPropertyOptional({ description: 'Ubicacion Lng', example: '-99.133209' })
  ubicacionLng: string | null;

  @Column('timestamp with time zone', {
    name: 'ultima_ubicacion_at',
    nullable: true,
  })
  @ApiPropertyOptional({ description: 'Ultima Ubicacion At', type: String, format: 'date-time', example: '2026-07-09T12:00:00.000Z' })
  ultimaUbicacionAt: Date | null;

  @Column('timestamp with time zone', {
    name: 'created_at',
    default: () => 'now()',
  })
  @ApiProperty({ description: 'Created At', type: String, format: 'date-time', example: '2026-07-09T12:00:00.000Z' })
  createdAt: Date;

  @Column('enum', {
    name: 'tipo',
    enum: ['independiente', 'agencia'],
    default: 'independiente',
  })
  @ApiProperty({ description: 'Tipo', enum: ['independiente', 'agencia'], example: 'independiente' })
  tipo: 'independiente' | 'agencia';

  @OneToMany(() => EmpleadaFotos, (empleadaFotos) => empleadaFotos.empleada)
  @ApiProperty({ description: 'Empleada Fotos', type: () => [EmpleadaFotos], example: [] })
  empleadaFotos: EmpleadaFotos[];

  @OneToOne(() => Usuarios, (usuarios) => usuarios.empleadas, {
    onDelete: 'CASCADE',
  })
  @JoinColumn([{ name: 'usuario_id', referencedColumnName: 'id' }])
  @ApiProperty({ description: 'Usuario', type: () => Usuarios })
  usuario: Usuarios;

  @OneToMany(() => ExtrasCatalogo, (extrasCatalogo) => extrasCatalogo.empleada)
  @ApiProperty({ description: 'Extras Catalogos', type: () => [ExtrasCatalogo], example: [] })
  extrasCatalogos: ExtrasCatalogo[];

  @OneToMany(() => Servicios, (servicios) => servicios.empleada)
  @ApiProperty({ description: 'Servicios', type: () => [Servicios], example: [] })
  servicios: Servicios[];

  @Column('uuid', { name: 'apartment_id', nullable: true })
  @ApiPropertyOptional({ description: 'Apartment Id', example: '00000000-0000-4000-8000-000000000000' })
  apartmentId: string | null;

  @ManyToOne(() => Apartments, (apartments) => apartments.empleadas, {
    onDelete: 'SET NULL',
  })
  @JoinColumn([{ name: 'apartment_id', referencedColumnName: 'id' }])
  @ApiProperty({ description: 'Apartment', type: () => Apartments })
  apartment: Apartments;

  @Column('uuid', { name: 'jefe_id', nullable: true })
  @ApiPropertyOptional({ description: 'Jefe Id', example: '00000000-0000-4000-8000-000000000000' })
  jefeId: string | null;

  @ManyToOne(() => Usuarios, { onDelete: 'SET NULL' })
  @JoinColumn([{ name: 'jefe_id', referencedColumnName: 'id' }])
  @ApiPropertyOptional({ description: 'Jefe', type: () => Usuarios })
  jefe: Usuarios | null;
}
