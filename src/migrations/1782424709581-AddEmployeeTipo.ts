import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEmployeeTipo1782424709581 implements MigrationInterface {
  name = 'AddEmployeeTipo1782424709581';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."empleadas_tipo_enum" AS ENUM('independiente', 'agencia')`,
    );
    await queryRunner.query(
      `ALTER TABLE "empleadas" ADD "tipo" "public"."empleadas_tipo_enum" NOT NULL DEFAULT 'independiente'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "empleadas" DROP COLUMN "tipo"`);
    await queryRunner.query(`DROP TYPE "public"."empleadas_tipo_enum"`);
  }
}
