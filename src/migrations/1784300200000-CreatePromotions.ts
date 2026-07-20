import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreatePromotions1784300200000 implements MigrationInterface {
  name = 'CreatePromotions1784300200000';
  async up(q: QueryRunner) { await q.query(`CREATE TABLE promotion_campaigns (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), offer text NOT NULL, tone varchar(80) NOT NULL DEFAULT 'amigable', filters jsonb NOT NULL DEFAULT '{}', created_by_user_id uuid NOT NULL REFERENCES usuarios(id), fingerprint varchar(64) NOT NULL UNIQUE, matched integer NOT NULL DEFAULT 0, queued integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()); CREATE TABLE promotion_deliveries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES promotion_campaigns(id) ON DELETE CASCADE, client_id uuid NOT NULL REFERENCES clientes(id), message text NOT NULL, status varchar(20) NOT NULL DEFAULT 'queued', error text, sent_at timestamptz, UNIQUE(campaign_id, client_id));`); }
  async down(q: QueryRunner) { await q.query('DROP TABLE IF EXISTS promotion_deliveries; DROP TABLE IF EXISTS promotion_campaigns;'); }
}
