import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateApartmentsTable1783118790000 implements MigrationInterface {
  name = 'CreateApartmentsTable1783118790000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create table apartments
    await queryRunner.query(`
      CREATE TABLE "apartments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "nombre" character varying(255) NOT NULL,
        "direccion" text,
        "descripcion" text,
        "ubicacion_lat" numeric(10,7),
        "ubicacion_lng" numeric(10,7),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_apartments_id" PRIMARY KEY ("id")
      )
    `);

    // 2. Add foreign key to empleadas
    await queryRunner.query(`
      ALTER TABLE "empleadas" 
      ADD COLUMN "apartment_id" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "empleadas" 
      ADD CONSTRAINT "FK_empleadas_apartment" 
      FOREIGN KEY ("apartment_id") 
      REFERENCES "apartments"("id") 
      ON DELETE SET NULL
    `);

    // 3. Create index for apartment_id in empleadas
    await queryRunner.query(`
      CREATE INDEX "IDX_empleadas_apartment_id" ON "empleadas" ("apartment_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Remove index and FK from empleadas
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_empleadas_apartment_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "empleadas" 
      DROP CONSTRAINT IF EXISTS "FK_empleadas_apartment"
    `);

    await queryRunner.query(`
      ALTER TABLE "empleadas" 
      DROP COLUMN IF EXISTS "apartment_id"
    `);

    // 2. Drop table apartments
    await queryRunner.query(`
      DROP TABLE "apartments"
    `);
  }
}
