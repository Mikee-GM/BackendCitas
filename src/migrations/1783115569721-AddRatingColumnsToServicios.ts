import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRatingColumnsToServicios1783115569721 implements MigrationInterface {
  name = 'AddRatingColumnsToServicios1783115569721';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "servicios" ADD "calificacion" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "servicios" ADD "comentarios_calificacion" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "servicios" DROP COLUMN "comentarios_calificacion"`,
    );
    await queryRunner.query(
      `ALTER TABLE "servicios" DROP COLUMN "calificacion"`,
    );
  }
}
