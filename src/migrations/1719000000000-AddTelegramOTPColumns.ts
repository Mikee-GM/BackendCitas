import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTelegramOTPColumns1719000000000 implements MigrationInterface {
  name = 'AddTelegramOTPColumns1719000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "usuarios" 
      ADD COLUMN "telegram_verification_code" character varying(255) NULL,
      ADD COLUMN "telegram_verification_expires_at" timestamp with time zone NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "usuarios" 
      DROP COLUMN "telegram_verification_expires_at",
      DROP COLUMN "telegram_verification_code";
    `);
  }
}
