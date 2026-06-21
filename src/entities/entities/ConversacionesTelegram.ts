import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { Clientes } from "./Clientes";
import { Servicios } from "./Servicios";

@Index("idx_conversaciones_cliente", ["clienteId"], {})
@Index("idx_conversaciones_enviado_at", ["enviadoAt"], {})
@Index("conversaciones_telegram_pkey", ["id"], { unique: true })
@Index("idx_conversaciones_servicio", ["servicioId"], {})
@Entity("conversaciones_telegram", { schema: "public" })
export class ConversacionesTelegram {
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

  @Column("enum", { name: "emisor", enum: ["ia", "jefe", "cliente"] })
  emisor: "ia" | "jefe" | "cliente";

  @Column("text", { name: "mensaje" })
  mensaje: string;

  @Column("boolean", { name: "ia_activa", default: () => "true" })
  iaActiva: boolean;

  @Column("timestamp with time zone", {
    name: "enviado_at",
    default: () => "now()",
  })
  enviadoAt: Date;

  @ManyToOne(() => Clientes, (clientes) => clientes.conversacionesTelegrams, {
    onDelete: "CASCADE",
  })
  @JoinColumn([{ name: "cliente_id", referencedColumnName: "id" }])
  cliente: Clientes;

  @ManyToOne(
    () => Servicios,
    (servicios) => servicios.conversacionesTelegrams,
    { onDelete: "SET NULL" },
  )
  @JoinColumn([{ name: "servicio_id", referencedColumnName: "id" }])
  servicio: Servicios;
}
