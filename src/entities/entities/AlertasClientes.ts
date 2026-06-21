import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { Usuarios } from "./Usuarios";
import { Clientes } from "./Clientes";
import { Servicios } from "./Servicios";

@Index("idx_alertas_atendida", ["atendida"], {})
@Index("idx_alertas_cliente", ["clienteId"], {})
@Index("alertas_clientes_pkey", ["id"], { unique: true })
@Index("idx_alertas_servicio", ["servicioId"], {})
@Entity("alertas_clientes", { schema: "public" })
export class AlertasClientes {
  @Column("uuid", {
    primary: true,
    name: "id",
    default: () => "gen_random_uuid()",
  })
  id: string;

  @Column("uuid", { name: "cliente_id" })
  clienteId: string;

  @Column("uuid", { name: "servicio_id", nullable: true })
  servicioId: string | null;

  @Column("text", { name: "mensaje_original" })
  mensajeOriginal: string;

  @Column("character varying", { name: "emocion_detectada", length: 50 })
  emocionDetectada: string;

  @Column("numeric", { name: "score_sentimiento", precision: 4, scale: 3 })
  scoreSentimiento: string;

  @Column("boolean", { name: "atendida", default: () => "false" })
  atendida: boolean;

  @Column("timestamp with time zone", { name: "atendida_at", nullable: true })
  atendidaAt: Date | null;

  @Column("timestamp with time zone", {
    name: "created_at",
    default: () => "now()",
  })
  createdAt: Date;

  @ManyToOne(() => Usuarios, (usuarios) => usuarios.alertasClientes, {
    onDelete: "SET NULL",
  })
  @JoinColumn([{ name: "atendida_por", referencedColumnName: "id" }])
  atendidaPor: Usuarios;

  @ManyToOne(() => Clientes, (clientes) => clientes.alertasClientes, {
    onDelete: "CASCADE",
  })
  @JoinColumn([{ name: "cliente_id", referencedColumnName: "id" }])
  cliente: Clientes;

  @ManyToOne(() => Servicios, (servicios) => servicios.alertasClientes, {
    onDelete: "SET NULL",
  })
  @JoinColumn([{ name: "servicio_id", referencedColumnName: "id" }])
  servicio: Servicios;
}
