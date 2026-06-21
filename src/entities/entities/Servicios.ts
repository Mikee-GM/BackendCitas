import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from "typeorm";
import { AlertasClientes } from "./AlertasClientes";
import { ConversacionesTelegram } from "./ConversacionesTelegram";
import { ExtensionesServicio } from "./ExtensionesServicio";
import { ExtrasServicio } from "./ExtrasServicio";
import { Prorrogas } from "./Prorrogas";
import { Clientes } from "./Clientes";
import { Empleadas } from "./Empleadas";
import { Usuarios } from "./Usuarios";
import { Viajes } from "./Viajes";

@Index("idx_servicios_cliente", ["clienteId"], {})
@Index("idx_servicios_created_at", ["createdAt"], {})
@Index("idx_servicios_empleada", ["empleadaId"], {})
@Index("idx_servicios_estado", ["estado"], {})
@Index("servicios_pkey", ["id"], { unique: true })
@Index("idx_servicios_jefe", ["jefeId"], {})
@Entity("servicios", { schema: "public" })
export class Servicios {
  @Column("uuid", {
    primary: true,
    name: "id",
    default: () => "gen_random_uuid()",
  })
  id: string;

  @Column("uuid", { name: "empleada_id" })
  empleadaId: string;

  @Column("uuid", { name: "cliente_id" })
  clienteId: string;

  @Column("uuid", { name: "jefe_id" })
  jefeId: string;

  @Column("enum", {
    name: "metodo_pago",
    enum: ["efectivo", "tarjeta", "transferencia"],
  })
  metodoPago: "efectivo" | "tarjeta" | "transferencia";

  @Column("numeric", { name: "duracion_pactada_horas", precision: 4, scale: 2 })
  duracionPactadaHoras: string;

  @Column("numeric", {
    name: "duracion_final_horas",
    nullable: true,
    precision: 4,
    scale: 2,
  })
  duracionFinalHoras: string | null;

  @Column("numeric", { name: "ubicacion_cliente_lat", precision: 10, scale: 7 })
  ubicacionClienteLat: string;

  @Column("numeric", { name: "ubicacion_cliente_lng", precision: 10, scale: 7 })
  ubicacionClienteLng: string;

  @Column("numeric", {
    name: "precio_base_hora_pactado",
    precision: 10,
    scale: 2,
  })
  precioBaseHoraPactado: string;

  @Column("numeric", {
    name: "total_base",
    precision: 10,
    scale: 2,
    default: () => "0",
  })
  totalBase: string;

  @Column("numeric", {
    name: "total_extras",
    precision: 10,
    scale: 2,
    default: () => "0",
  })
  totalExtras: string;

  @Column("numeric", {
    name: "total_final",
    precision: 10,
    scale: 2,
    default: () => "0",
  })
  totalFinal: string;

  @Column("timestamp with time zone", {
    name: "hora_inicio_servicio",
    nullable: true,
  })
  horaInicioServicio: Date | null;

  @Column("timestamp with time zone", {
    name: "hora_fin_servicio",
    nullable: true,
  })
  horaFinServicio: Date | null;

  @Column("timestamp with time zone", {
    name: "hora_llegada_casa",
    nullable: true,
  })
  horaLlegadaCasa: Date | null;

  @Column("smallint", { name: "prorrogas_usadas", default: () => "0" })
  prorrogasUsadas: number;

  @Column("enum", {
    name: "estado",
    enum: ["pendiente", "en_curso", "finalizado", "cancelado"],
    default: () => "'pendiente'",
  })
  estado: "pendiente" | "en_curso" | "finalizado" | "cancelado";

  @Column("text", { name: "notas", nullable: true })
  notas: string | null;

  @Column("timestamp with time zone", {
    name: "created_at",
    default: () => "now()",
  })
  createdAt: Date;

  @Column("timestamp with time zone", {
    name: "updated_at",
    default: () => "now()",
  })
  updatedAt: Date;

  @OneToMany(
    () => AlertasClientes,
    (alertasClientes) => alertasClientes.servicio,
  )
  alertasClientes: AlertasClientes[];

  @OneToMany(
    () => ConversacionesTelegram,
    (conversacionesTelegram) => conversacionesTelegram.servicio,
  )
  conversacionesTelegrams: ConversacionesTelegram[];

  @OneToMany(
    () => ExtensionesServicio,
    (extensionesServicio) => extensionesServicio.servicio,
  )
  extensionesServicios: ExtensionesServicio[];

  @OneToMany(() => ExtrasServicio, (extrasServicio) => extrasServicio.servicio)
  extrasServicios: ExtrasServicio[];

  @OneToMany(() => Prorrogas, (prorrogas) => prorrogas.servicio)
  prorrogases: Prorrogas[];

  @ManyToOne(() => Clientes, (clientes) => clientes.servicios, {
    onDelete: "RESTRICT",
  })
  @JoinColumn([{ name: "cliente_id", referencedColumnName: "id" }])
  cliente: Clientes;

  @ManyToOne(() => Empleadas, (empleadas) => empleadas.servicios, {
    onDelete: "RESTRICT",
  })
  @JoinColumn([{ name: "empleada_id", referencedColumnName: "id" }])
  empleada: Empleadas;

  @ManyToOne(() => Usuarios, (usuarios) => usuarios.servicios, {
    onDelete: "RESTRICT",
  })
  @JoinColumn([{ name: "jefe_id", referencedColumnName: "id" }])
  jefe: Usuarios;

  @OneToMany(() => Viajes, (viajes) => viajes.servicio)
  viajes: Viajes[];
}
