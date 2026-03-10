require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('./db');

async function main() {
  console.log('🔧 Creating database schema...\n');
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

    DO $$ BEGIN
      CREATE TYPE user_role      AS ENUM ('customer','admin','superadmin');
      CREATE TYPE order_status   AS ENUM ('pending','confirmed','processing','shipped','delivered','cancelled','refunded');
      CREATE TYPE payment_status AS ENUM ('pending','paid','failed','refunded','cod_pending');
      CREATE TYPE payment_method AS ENUM ('cod','jazzcash','easypaisa','bank_transfer');
      CREATE TYPE product_type   AS ENUM ('straight','blowdry');
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    CREATE TABLE IF NOT EXISTS users (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      full_name       VARCHAR(100) NOT NULL,
      email           VARCHAR(150) UNIQUE NOT NULL,
      phone           VARCHAR(20),
      password_hash   VARCHAR(255) NOT NULL,
      role            user_role DEFAULT 'customer',
      is_verified     BOOLEAN DEFAULT false,
      refresh_token   VARCHAR(500),
      reset_token     VARCHAR(255),
      reset_token_exp TIMESTAMPTZ,
      city            VARCHAR(80),
      address         TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS shades (
      id           SERIAL PRIMARY KEY,
      key          VARCHAR(30) UNIQUE NOT NULL,
      name         VARCHAR(80) NOT NULL,
      color_hex    VARCHAR(20),
      is_highlight BOOLEAN DEFAULT false,
      sort_order   INT DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS products (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      slug          VARCHAR(120) UNIQUE NOT NULL,
      name          VARCHAR(150) NOT NULL,
      description   TEXT,
      category      VARCHAR(50) NOT NULL,
      type          product_type NOT NULL,
      badge         VARCHAR(40),
      price         NUMERIC(10,2) NOT NULL,
      compare_price NUMERIC(10,2),
      is_active     BOOLEAN DEFAULT true,
      is_featured   BOOLEAN DEFAULT false,
      sort_order    INT DEFAULT 0,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_products_slug     ON products(slug);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
    CREATE INDEX IF NOT EXISTS idx_products_active   ON products(is_active);

    CREATE TABLE IF NOT EXISTS product_features (
      id         SERIAL PRIMARY KEY,
      product_id UUID REFERENCES products(id) ON DELETE CASCADE,
      feature    VARCHAR(200) NOT NULL,
      sort_order INT DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS product_variants (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      product_id UUID REFERENCES products(id) ON DELETE CASCADE,
      shade_key  VARCHAR(30) REFERENCES shades(key),
      sku        VARCHAR(80) UNIQUE,
      stock_qty  INT DEFAULT 100,
      is_active  BOOLEAN DEFAULT true,
      UNIQUE(product_id, shade_key)
    );
    CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);

    CREATE TABLE IF NOT EXISTS product_images (
      id         SERIAL PRIMARY KEY,
      product_id UUID REFERENCES products(id) ON DELETE CASCADE,
      shade_key  VARCHAR(30),
      url        VARCHAR(400) NOT NULL,
      alt_text   VARCHAR(200),
      is_primary BOOLEAN DEFAULT false,
      sort_order INT DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS orders (
      id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      order_number        VARCHAR(20) UNIQUE NOT NULL,
      user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
      status              order_status DEFAULT 'pending',
      payment_status      payment_status DEFAULT 'pending',
      payment_method      payment_method NOT NULL,
      shipping_name       VARCHAR(100) NOT NULL,
      shipping_phone      VARCHAR(20) NOT NULL,
      shipping_email      VARCHAR(150),
      shipping_address    TEXT NOT NULL,
      shipping_city       VARCHAR(80) NOT NULL,
      shipping_notes      TEXT,
      subtotal            NUMERIC(10,2) NOT NULL,
      shipping_fee        NUMERIC(10,2) DEFAULT 0,
      discount            NUMERIC(10,2) DEFAULT 0,
      total               NUMERIC(10,2) NOT NULL,
      jazzcash_txn_id     VARCHAR(100),
      jazzcash_txn_ref    VARCHAR(200),
      jazzcash_response   JSONB,
      tracking_number     VARCHAR(100),
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      updated_at          TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_orders_user    ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_number  ON orders(order_number);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

    CREATE TABLE IF NOT EXISTS order_items (
      id           SERIAL PRIMARY KEY,
      order_id     UUID REFERENCES orders(id) ON DELETE CASCADE,
      product_id   UUID REFERENCES products(id) ON DELETE SET NULL,
      variant_id   UUID REFERENCES product_variants(id) ON DELETE SET NULL,
      product_name VARCHAR(150) NOT NULL,
      shade_name   VARCHAR(80) NOT NULL,
      shade_key    VARCHAR(30) NOT NULL,
      unit_price   NUMERIC(10,2) NOT NULL,
      quantity     INT NOT NULL DEFAULT 1,
      line_total   NUMERIC(10,2) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS carts (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id    UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
      session_id VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS cart_items (
      id         SERIAL PRIMARY KEY,
      cart_id    UUID REFERENCES carts(id) ON DELETE CASCADE,
      variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
      quantity   INT NOT NULL DEFAULT 1,
      added_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(cart_id, variant_id)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id            SERIAL PRIMARY KEY,
      product_id    UUID REFERENCES products(id) ON DELETE CASCADE,
      user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
      reviewer_name VARCHAR(80),
      rating        SMALLINT CHECK (rating BETWEEN 1 AND 5),
      comment       TEXT,
      is_approved   BOOLEAN DEFAULT false,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id, is_approved);

    CREATE OR REPLACE FUNCTION update_updated_at()
    RETURNS TRIGGER AS $fn$
    BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
    $fn$ LANGUAGE plpgsql;

    DO $trg$ DECLARE t TEXT;
    BEGIN
      FOR t IN SELECT unnest(ARRAY['users','products','orders','carts']) LOOP
        EXECUTE format(
          'DROP TRIGGER IF EXISTS trg_%s ON %I;
           CREATE TRIGGER trg_%s BEFORE UPDATE ON %I
           FOR EACH ROW EXECUTE FUNCTION update_updated_at();', t, t, t, t);
      END LOOP;
    END $trg$;

    CREATE SEQUENCE IF NOT EXISTS order_seq START 1000;
  `);
  console.log('✅ Schema created!\n');
  console.log('Next: npm run db:seed\n');
  await pool.end();
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
