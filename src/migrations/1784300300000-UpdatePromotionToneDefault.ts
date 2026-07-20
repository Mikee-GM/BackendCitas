import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdatePromotionToneDefault1784300300000 implements MigrationInterface {
  name = 'UpdatePromotionToneDefault1784300300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE promotion_campaigns
      ALTER COLUMN tone SET DEFAULT 'coqueta'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE promotion_campaigns
      ALTER COLUMN tone SET DEFAULT 'amigable'
    `);
  }
}
