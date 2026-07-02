import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeChoferIdNullable1782424709582 implements MigrationInterface {
  name = 'MakeChoferIdNullable1782424709582';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "viajes" ALTER COLUMN "chofer_id" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "viajes" ALTER COLUMN "chofer_id" SET NOT NULL`,
    );
  }
}
