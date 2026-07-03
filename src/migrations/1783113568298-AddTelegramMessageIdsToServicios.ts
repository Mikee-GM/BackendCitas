import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTelegramMessageIdsToServicios1783113568298 implements MigrationInterface {
  name = 'AddTelegramMessageIdsToServicios1783113568298';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "servicios" ADD "telegram_cliente_mensaje_id" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "servicios" ADD "telegram_empleada_mensaje_id" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "servicios" DROP COLUMN "telegram_empleada_mensaje_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "servicios" DROP COLUMN "telegram_cliente_mensaje_id"`,
    );
  }
}
