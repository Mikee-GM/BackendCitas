import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNombreAndApellidoToUsuarios1783118930000 implements MigrationInterface {
  name = 'AddNombreAndApellidoToUsuarios1783118930000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE usuarios
      ADD COLUMN IF NOT EXISTS nombre character varying(255),
      ADD COLUMN IF NOT EXISTS apellido character varying(255);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE usuarios
      DROP COLUMN IF EXISTS nombre,
      DROP COLUMN IF EXISTS apellido;
    `);
  }
}
