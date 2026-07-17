import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveIndependentEmployees1784650333000 implements MigrationInterface {
  name = 'RemoveIndependentEmployees1784650333000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "empleadas" DROP COLUMN IF EXISTS "tipo"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "empleadas_tipo_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "empleadas_tipo_enum" AS ENUM('independiente', 'agencia')`,
    );
    await queryRunner.query(
      `ALTER TABLE "empleadas" ADD "tipo" "empleadas_tipo_enum" NOT NULL DEFAULT 'independiente'`,
    );
  }
}
