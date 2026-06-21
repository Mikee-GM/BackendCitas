import { Column, Entity, Index, OneToMany, OneToOne } from 'typeorm';
import { AlertasClientes } from '../../client-alerts/entities/client-alert.entity';
import { Choferes } from '../../drivers/entities/driver.entity';
import { Empleadas } from '../../employees/entities/employee.entity';
import { ExtrasServicio } from '../../service-extras/entities/service-extra.entity';
import { Servicios } from '../../services/entities/service.entity';

@Index('usuarios_email_key', ['email'], { unique: true })
@Index('usuarios_pkey', ['id'], { unique: true })
@Index('idx_usuarios_rol', ['rol'], {})
@Index('usuarios_telegram_chat_id_key', ['telegramChatId'], { unique: true })
@Entity('usuarios', { schema: 'public' })
export class Usuarios {
  @Column('uuid', {
    primary: true,
    name: 'id',
    default: () => 'gen_random_uuid()',
  })
  id: string;

  @Column('character varying', { name: 'email', unique: true, length: 255 })
  email: string;

  @Column('text', { name: 'password_hash' })
  passwordHash: string;

  @Column('enum', {
    name: 'rol',
    enum: ['jefe', 'empleada', 'chofer', 'admin'],
  })
  rol: 'jefe' | 'empleada' | 'chofer' | 'admin';

  @Column('boolean', { name: 'activo', default: () => 'true' })
  activo: boolean;

  @Column('bigint', { name: 'telegram_chat_id', nullable: true, unique: true })
  telegramChatId: string | null;

  @Column('timestamp with time zone', {
    name: 'created_at',
    default: () => 'now()',
  })
  createdAt: Date;

  @Column('timestamp with time zone', { name: 'last_login_at', nullable: true })
  lastLoginAt: Date | null;

  @OneToMany(
    () => AlertasClientes,
    (alertasClientes) => alertasClientes.atendidaPor,
  )
  alertasClientes: AlertasClientes[];

  @OneToOne(() => Choferes, (choferes) => choferes.usuario)
  choferes: Choferes;

  @OneToOne(() => Empleadas, (empleadas) => empleadas.usuario)
  empleadas: Empleadas;

  @OneToMany(
    () => ExtrasServicio,
    (extrasServicio) => extrasServicio.registradoPor,
  )
  extrasServicios: ExtrasServicio[];

  @OneToMany(() => Servicios, (servicios) => servicios.jefe)
  servicios: Servicios[];
}
