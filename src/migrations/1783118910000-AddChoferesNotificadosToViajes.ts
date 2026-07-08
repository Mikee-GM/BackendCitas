import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChoferesNotificadosToViajes1783118910000 implements MigrationInterface {
  name = 'AddChoferesNotificadosToViajes1783118910000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE viajes
      ADD COLUMN IF NOT EXISTS choferes_notificados jsonb DEFAULT '[]'::jsonb;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE viajes
      DROP COLUMN IF EXISTS choferes_notificados;
    `);
  }
}
