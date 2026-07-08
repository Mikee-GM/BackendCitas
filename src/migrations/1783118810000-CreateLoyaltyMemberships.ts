import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLoyaltyMemberships1783118810000 implements MigrationInterface {
  name = 'CreateLoyaltyMemberships1783118810000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE client_memberships_status_enum AS ENUM (
        'active',
        'inactive',
        'suspended'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE client_memberships_assignment_type_enum AS ENUM (
        'automatic',
        'manual'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE loyalty_transactions_type_enum AS ENUM (
        'earned',
        'manual_adjustment',
        'tier_assignment',
        'reversal'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE loyalty_tiers (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        code character varying(50) NOT NULL,
        name character varying(120) NOT NULL,
        min_spend numeric(12,2) NOT NULL DEFAULT 0,
        earn_rate numeric(10,4) NOT NULL DEFAULT 0.1000,
        active boolean NOT NULL DEFAULT true,
        sort_order integer NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT loyalty_tiers_pkey PRIMARY KEY (id),
        CONSTRAINT loyalty_tiers_code_key UNIQUE (code)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX idx_loyalty_tiers_active_min_spend
      ON loyalty_tiers (active, min_spend);
    `);

    await queryRunner.query(`
      CREATE TABLE client_memberships (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        cliente_id uuid NOT NULL,
        tier_id uuid NOT NULL,
        status client_memberships_status_enum NOT NULL DEFAULT 'active',
        assignment_type client_memberships_assignment_type_enum NOT NULL DEFAULT 'automatic',
        points_balance integer NOT NULL DEFAULT 0,
        lifetime_points integer NOT NULL DEFAULT 0,
        lifetime_spend numeric(12,2) NOT NULL DEFAULT 0,
        assigned_by_user_id uuid,
        assignment_notes text,
        joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        assigned_at TIMESTAMP WITH TIME ZONE,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT client_memberships_pkey PRIMARY KEY (id),
        CONSTRAINT client_memberships_cliente_id_key UNIQUE (cliente_id),
        CONSTRAINT fk_client_memberships_cliente
          FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
        CONSTRAINT fk_client_memberships_tier
          FOREIGN KEY (tier_id) REFERENCES loyalty_tiers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_client_memberships_assigned_by
          FOREIGN KEY (assigned_by_user_id) REFERENCES usuarios(id) ON DELETE SET NULL
      );
    `);

    await queryRunner.query(`
      CREATE INDEX idx_client_memberships_tier
      ON client_memberships (tier_id);
    `);

    await queryRunner.query(`
      CREATE TABLE loyalty_transactions (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        cliente_id uuid NOT NULL,
        servicio_id uuid,
        created_by_user_id uuid,
        type loyalty_transactions_type_enum NOT NULL,
        points integer NOT NULL,
        amount_basis numeric(12,2),
        description text,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT loyalty_transactions_pkey PRIMARY KEY (id),
        CONSTRAINT fk_loyalty_transactions_cliente
          FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
        CONSTRAINT fk_loyalty_transactions_servicio
          FOREIGN KEY (servicio_id) REFERENCES servicios(id) ON DELETE SET NULL,
        CONSTRAINT fk_loyalty_transactions_created_by
          FOREIGN KEY (created_by_user_id) REFERENCES usuarios(id) ON DELETE SET NULL
      );
    `);

    await queryRunner.query(`
      CREATE INDEX idx_loyalty_transactions_cliente
      ON loyalty_transactions (cliente_id);
    `);

    await queryRunner.query(`
      CREATE INDEX idx_loyalty_transactions_servicio
      ON loyalty_transactions (servicio_id);
    `);

    await queryRunner.query(`
      CREATE INDEX idx_loyalty_transactions_created_at
      ON loyalty_transactions (created_at);
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX loyalty_transactions_service_type_key
      ON loyalty_transactions (servicio_id, type);
    `);

    await queryRunner.query(`
      INSERT INTO loyalty_tiers (code, name, min_spend, earn_rate, sort_order)
      VALUES
        ('bronce', 'Bronce', 0, 0.1000, 1),
        ('plata', 'Plata', 10000, 0.1000, 2),
        ('oro', 'Oro', 30000, 0.1000, 3),
        ('vip', 'VIP', 70000, 0.1000, 4)
      ON CONFLICT (code) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS loyalty_transactions_service_type_key;`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_loyalty_transactions_created_at;`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_loyalty_transactions_servicio;`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_loyalty_transactions_cliente;`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS loyalty_transactions;`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_client_memberships_tier;`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS client_memberships;`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_loyalty_tiers_active_min_spend;`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS loyalty_tiers;`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS loyalty_transactions_type_enum;`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS client_memberships_assignment_type_enum;`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS client_memberships_status_enum;`,
    );
  }
}
