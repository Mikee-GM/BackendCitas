import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTelegramChoferMsgOfertaId1783118920000 implements MigrationInterface {
  name = 'AddTelegramChoferMsgOfertaId1783118920000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE viajes
      ADD COLUMN IF NOT EXISTS telegram_chofer_msg_oferta_id varchar(255) DEFAULT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE viajes
      DROP COLUMN IF EXISTS telegram_chofer_msg_oferta_id;
    `);
  }
}
