import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { Servicios } from "./Servicios";

@Index("prorrogas_pkey", ["id"], { unique: true })
@Index(
  "prorrogas_servicio_id_numero_prorroga_key",
  ["numeroProrroga", "servicioId"],
  { unique: true },
)
@Index("idx_prorrogas_servicio", ["servicioId"], {})
@Entity("prorrogas", { schema: "public" })
export class Prorrogas {
  @Column("uuid", {
    primary: true,
    name: "id",
    default: () => "gen_random_uuid()",
  })
  id: string;

  @Column("uuid", { name: "servicio_id", unique: true })
  servicioId: string;

  @Column("smallint", { name: "numero_prorroga", unique: true })
  numeroProrroga: number;

  @Column("smallint", { name: "minutos_solicitados" })
  minutosSolicitados: number;

  @Column("timestamp with time zone", {
    name: "solicitada_at",
    default: () => "now()",
  })
  solicitadaAt: Date;

  @Column("boolean", { name: "aprobada", default: () => "true" })
  aprobada: boolean;

  @ManyToOne(() => Servicios, (servicios) => servicios.prorrogases, {
    onDelete: "CASCADE",
  })
  @JoinColumn([{ name: "servicio_id", referencedColumnName: "id" }])
  servicio: Servicios;
}
