import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEmployeeRatings1784300400000 implements MigrationInterface {
  name = 'CreateEmployeeRatings1784300400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."employee_ratings_source_enum" AS ENUM('chofer', 'jefe')`);
    await queryRunner.query(`CREATE TABLE "employee_ratings" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "employee_id" uuid NOT NULL, "source" "public"."employee_ratings_source_enum" NOT NULL, "rater_user_id" uuid, "reference_id" uuid, "rating" smallint NOT NULL CHECK ("rating" BETWEEN 1 AND 5), "comment" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_employee_ratings" PRIMARY KEY ("id"), CONSTRAINT "FK_employee_ratings_employee" FOREIGN KEY ("employee_id") REFERENCES "empleadas"("id") ON DELETE CASCADE)`);
    await queryRunner.query(`CREATE INDEX "idx_employee_ratings_employee_source" ON "employee_ratings" ("employee_id", "source")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_employee_ratings_employee_source"`);
    await queryRunner.query(`DROP TABLE "employee_ratings"`);
    await queryRunner.query(`DROP TYPE "public"."employee_ratings_source_enum"`);
  }
}
