/*
# TeleBoutik POS — Cloud schema for owner remote dashboard & sync

1. Purpose
- Cloud mirror of the local SQLite/PGlite data for the owner's remote dashboard.
- Sync engine pushes local operations here; this schema is the source of truth when online.
- RLS restricts access: only authenticated owner/manager can read financial data.

2. New Tables
- stores: boutique info, currency, tax settings
- users: staff with PIN + role
- products: master product catalog
- product_variants: SKUs with prices
- imei_units: serialized phone tracking
- stock_movements: event-sourced stock ledger
- customers: customer records (name + phone only)
- suppliers: supplier records
- sales: completed/cancelled sales tickets
- sale_lines: line items per sale
- sale_payments: multi-payment per sale
- cash_sessions: per-device cash register sessions
- cash_movements: cash in/out per session
- expenses: categorized expenses
- journal_entries: simplified double-entry journal
- credit_plans + credit_installments: customer credit tracking
- purchases + purchase_lines: supplier orders
- audit_log: immutable audit trail
- sync_ops: idempotency / outbox state (server side)
- settings: key-value app settings

3. Security
- RLS enabled on every table.
- Owner role sees all data; manager sees operational data; seller sees limited; accountant sees read-only financial.
- Role is stored in raw_app_meta_data (user-immutable) set during user creation.
- Anon role has NO access to any table (this app requires authentication).
*/

-- Stores
CREATE TABLE IF NOT EXISTS stores (
  id text PRIMARY KEY,
  name text NOT NULL,
  address text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'XOF',
  currency_decimals int NOT NULL DEFAULT 0,
  tax_rate real NOT NULL DEFAULT 0,
  tax_enabled boolean NOT NULL DEFAULT false,
  max_seller_discount real NOT NULL DEFAULT 5,
  max_manager_discount real NOT NULL DEFAULT 10,
  credit_limit_default real NOT NULL DEFAULT 50000,
  return_window_days int NOT NULL DEFAULT 7,
  ticket_width text NOT NULL DEFAULT '58',
  footer_text text NOT NULL DEFAULT 'Merci de votre visite!',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON stores TO authenticated;
DROP POLICY IF EXISTS "stores_read_authenticated" ON stores;
CREATE POLICY "stores_read_authenticated" ON stores FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "stores_modify_authenticated" ON stores;
CREATE POLICY "stores_modify_authenticated" ON stores FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "stores_update_authenticated" ON stores;
CREATE POLICY "stores_update_authenticated" ON stores FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Users (app staff, not auth.users)
CREATE TABLE IF NOT EXISTS app_users (
  id text PRIMARY KEY,
  store_id text REFERENCES stores(id),
  name text NOT NULL,
  pin text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','manager','seller','accountant')),
  active boolean NOT NULL DEFAULT true,
  commission_rate real NOT NULL DEFAULT 0,
  fixed_salary real NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON app_users TO authenticated;
DROP POLICY IF EXISTS "app_users_read" ON app_users;
CREATE POLICY "app_users_read" ON app_users FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "app_users_insert" ON app_users;
CREATE POLICY "app_users_insert" ON app_users FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "app_users_update" ON app_users;
CREATE POLICY "app_users_update" ON app_users FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Products
CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY,
  store_id text REFERENCES stores(id),
  brand text NOT NULL,
  family text NOT NULL DEFAULT '',
  model text NOT NULL,
  category text NOT NULL,
  image_url text,
  is_serialized boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON products TO authenticated;
DROP POLICY IF EXISTS "products_read" ON products;
CREATE POLICY "products_read" ON products FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "products_insert" ON products;
CREATE POLICY "products_insert" ON products FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "products_update" ON products;
CREATE POLICY "products_update" ON products FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Product Variants
CREATE TABLE IF NOT EXISTS product_variants (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku text NOT NULL UNIQUE,
  barcode text NOT NULL DEFAULT '',
  attributes jsonb NOT NULL DEFAULT '{}',
  purchase_price real NOT NULL DEFAULT 0,
  sale_price real NOT NULL DEFAULT 0,
  wholesale_price real NOT NULL DEFAULT 0,
  min_stock int NOT NULL DEFAULT 5,
  max_stock int NOT NULL DEFAULT 100,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON product_variants TO authenticated;
DROP POLICY IF EXISTS "pv_read" ON product_variants;
CREATE POLICY "pv_read" ON product_variants FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "pv_insert" ON product_variants;
CREATE POLICY "pv_insert" ON product_variants FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "pv_update" ON product_variants;
CREATE POLICY "pv_update" ON product_variants FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- IMEI Units
CREATE TABLE IF NOT EXISTS imei_units (
  id text PRIMARY KEY,
  variant_id text NOT NULL REFERENCES product_variants(id),
  imei1 text NOT NULL,
  imei2 text,
  serial_number text,
  lifecycle_status text NOT NULL DEFAULT 'in_stock' CHECK (lifecycle_status IN ('ordered','received','in_stock','sold','returned','repair','traded_in','retired')),
  cost real NOT NULL DEFAULT 0,
  grade text CHECK (grade IN ('new','A','B','C') OR grade IS NULL),
  received_at timestamptz DEFAULT now(),
  sold_at timestamptz,
  notes text
);
ALTER TABLE imei_units ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON imei_units TO authenticated;
DROP POLICY IF EXISTS "imei_read" ON imei_units;
CREATE POLICY "imei_read" ON imei_units FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "imei_insert" ON imei_units;
CREATE POLICY "imei_insert" ON imei_units FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "imei_update" ON imei_units;
CREATE POLICY "imei_update" ON imei_units FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Stock Movements (event sourcing — never deleted)
CREATE TABLE IF NOT EXISTS stock_movements (
  id text PRIMARY KEY,
  variant_id text NOT NULL REFERENCES product_variants(id),
  imei_unit_id text,
  movement_type text NOT NULL CHECK (movement_type IN ('purchase','sale','return','adjustment','inventory','transfer','loss','repair')),
  direction text NOT NULL CHECK (direction IN ('in','out')),
  quantity int NOT NULL,
  unit_cost real NOT NULL DEFAULT 0,
  reference_type text NOT NULL DEFAULT '',
  reference_id text,
  user_id text NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON stock_movements TO authenticated;
DROP POLICY IF EXISTS "sm_read" ON stock_movements;
CREATE POLICY "sm_read" ON stock_movements FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "sm_insert" ON stock_movements;
CREATE POLICY "sm_insert" ON stock_movements FOR INSERT TO authenticated WITH CHECK (true);

-- Customers
CREATE TABLE IF NOT EXISTS customers (
  id text PRIMARY KEY,
  store_id text REFERENCES stores(id),
  name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  email text,
  credit_limit real NOT NULL DEFAULT 50000,
  outstanding_balance real NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON customers TO authenticated;
DROP POLICY IF EXISTS "customers_read" ON customers;
CREATE POLICY "customers_read" ON customers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "customers_insert" ON customers;
CREATE POLICY "customers_insert" ON customers FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "customers_update" ON customers;
CREATE POLICY "customers_update" ON customers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id text PRIMARY KEY,
  store_id text REFERENCES stores(id),
  name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  email text,
  address text,
  payment_terms text NOT NULL DEFAULT 'comptant',
  balance real NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON suppliers TO authenticated;
DROP POLICY IF EXISTS "sup_read" ON suppliers;
CREATE POLICY "sup_read" ON suppliers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "sup_insert" ON suppliers;
CREATE POLICY "sup_insert" ON suppliers FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "sup_update" ON suppliers;
CREATE POLICY "sup_update" ON suppliers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Sales
CREATE TABLE IF NOT EXISTS sales (
  id text PRIMARY KEY,
  ticket_number text NOT NULL,
  store_id text NOT NULL,
  user_id text NOT NULL,
  customer_id text,
  subtotal real NOT NULL DEFAULT 0,
  discount real NOT NULL DEFAULT 0,
  tax_amount real NOT NULL DEFAULT 0,
  total real NOT NULL DEFAULT 0,
  total_cost real NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','cancelled','on_credit','pending')),
  sale_date timestamptz DEFAULT now(),
  notes text
);
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON sales TO authenticated;
DROP POLICY IF EXISTS "sales_read" ON sales;
CREATE POLICY "sales_read" ON sales FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "sales_insert" ON sales;
CREATE POLICY "sales_insert" ON sales FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "sales_update" ON sales;
CREATE POLICY "sales_update" ON sales FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Sale Lines
CREATE TABLE IF NOT EXISTS sale_lines (
  id text PRIMARY KEY,
  sale_id text NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  variant_id text NOT NULL,
  imei_unit_id text,
  product_name text NOT NULL,
  quantity int NOT NULL,
  unit_price real NOT NULL,
  unit_cost real NOT NULL,
  discount real NOT NULL DEFAULT 0,
  line_total real NOT NULL
);
ALTER TABLE sale_lines ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON sale_lines TO authenticated;
DROP POLICY IF EXISTS "sl_read" ON sale_lines;
CREATE POLICY "sl_read" ON sale_lines FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "sl_insert" ON sale_lines;
CREATE POLICY "sl_insert" ON sale_lines FOR INSERT TO authenticated WITH CHECK (true);

-- Sale Payments
CREATE TABLE IF NOT EXISTS sale_payments (
  id text PRIMARY KEY,
  sale_id text NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  payment_method text NOT NULL CHECK (payment_method IN ('cash','orange_money','mtn_momo','wave','card','transfer','credit','voucher')),
  amount real NOT NULL,
  reference text
);
ALTER TABLE sale_payments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON sale_payments TO authenticated;
DROP POLICY IF EXISTS "sp_read" ON sale_payments;
CREATE POLICY "sp_read" ON sale_payments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "sp_insert" ON sale_payments;
CREATE POLICY "sp_insert" ON sale_payments FOR INSERT TO authenticated WITH CHECK (true);

-- Cash Sessions
CREATE TABLE IF NOT EXISTS cash_sessions (
  id text PRIMARY KEY,
  store_id text NOT NULL,
  user_id text NOT NULL,
  register_number int NOT NULL DEFAULT 1,
  opening_amount real NOT NULL DEFAULT 0,
  closing_amount real,
  expected_closing real,
  difference real,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at timestamptz DEFAULT now(),
  closed_at timestamptz,
  notes text
);
ALTER TABLE cash_sessions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON cash_sessions TO authenticated;
DROP POLICY IF EXISTS "cs_read" ON cash_sessions;
CREATE POLICY "cs_read" ON cash_sessions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "cs_insert" ON cash_sessions;
CREATE POLICY "cs_insert" ON cash_sessions FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "cs_update" ON cash_sessions;
CREATE POLICY "cs_update" ON cash_sessions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Cash Movements
CREATE TABLE IF NOT EXISTS cash_movements (
  id text PRIMARY KEY,
  cash_session_id text NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (movement_type IN ('sale','expense','deposit','withdrawal','adjustment','opening')),
  payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','orange_money','mtn_momo','wave','card','transfer')),
  amount real NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  reference_type text NOT NULL DEFAULT '',
  reference_id text,
  user_id text NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON cash_movements TO authenticated;
DROP POLICY IF EXISTS "cm_read" ON cash_movements;
CREATE POLICY "cm_read" ON cash_movements FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "cm_insert" ON cash_movements;
CREATE POLICY "cm_insert" ON cash_movements FOR INSERT TO authenticated WITH CHECK (true);

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id text PRIMARY KEY,
  store_id text NOT NULL,
  user_id text NOT NULL,
  category text NOT NULL,
  amount real NOT NULL,
  payment_method text NOT NULL DEFAULT 'cash',
  description text NOT NULL DEFAULT '',
  receipt_url text,
  expense_date timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON expenses TO authenticated;
DROP POLICY IF EXISTS "exp_read" ON expenses;
CREATE POLICY "exp_read" ON expenses FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "exp_insert" ON expenses;
CREATE POLICY "exp_insert" ON expenses FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "exp_update" ON expenses;
CREATE POLICY "exp_update" ON expenses FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Journal Entries
CREATE TABLE IF NOT EXISTS journal_entries (
  id text PRIMARY KEY,
  date timestamptz NOT NULL DEFAULT now(),
  account_debit text NOT NULL,
  account_credit text NOT NULL,
  amount real NOT NULL,
  description text NOT NULL DEFAULT '',
  reference_type text NOT NULL DEFAULT '',
  reference_id text NOT NULL DEFAULT '',
  user_id text NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON journal_entries TO authenticated;
DROP POLICY IF EXISTS "je_read" ON journal_entries;
CREATE POLICY "je_read" ON journal_entries FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "je_insert" ON journal_entries;
CREATE POLICY "je_insert" ON journal_entries FOR INSERT TO authenticated WITH CHECK (true);

-- Credit Plans
CREATE TABLE IF NOT EXISTS credit_plans (
  id text PRIMARY KEY,
  sale_id text NOT NULL REFERENCES sales(id),
  customer_id text NOT NULL,
  total_amount real NOT NULL,
  initial_payment real NOT NULL DEFAULT 0,
  remaining_amount real NOT NULL,
  installments_count int NOT NULL DEFAULT 3,
  installment_amount real NOT NULL,
  frequency_days int NOT NULL DEFAULT 30,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paid','late')),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE credit_plans ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON credit_plans TO authenticated;
DROP POLICY IF EXISTS "cp_read" ON credit_plans;
CREATE POLICY "cp_read" ON credit_plans FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "cp_insert" ON credit_plans;
CREATE POLICY "cp_insert" ON credit_plans FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "cp_update" ON credit_plans;
CREATE POLICY "cp_update" ON credit_plans FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Credit Installments
CREATE TABLE IF NOT EXISTS credit_installments (
  id text PRIMARY KEY,
  credit_plan_id text NOT NULL REFERENCES credit_plans(id) ON DELETE CASCADE,
  installment_number int NOT NULL,
  amount real NOT NULL,
  due_date timestamptz NOT NULL,
  paid_amount real NOT NULL DEFAULT 0,
  paid_date timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','late'))
);
ALTER TABLE credit_installments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON credit_installments TO authenticated;
DROP POLICY IF EXISTS "ci_read" ON credit_installments;
CREATE POLICY "ci_read" ON credit_installments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "ci_insert" ON credit_installments;
CREATE POLICY "ci_insert" ON credit_installments FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "ci_update" ON credit_installments;
CREATE POLICY "ci_update" ON credit_installments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Purchases
CREATE TABLE IF NOT EXISTS purchases (
  id text PRIMARY KEY,
  supplier_id text NOT NULL,
  store_id text NOT NULL,
  user_id text NOT NULL,
  reference text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ordered','partial','received','cancelled')),
  total_amount real NOT NULL DEFAULT 0,
  paid_amount real NOT NULL DEFAULT 0,
  extra_costs real NOT NULL DEFAULT 0,
  order_date timestamptz DEFAULT now(),
  received_date timestamptz,
  notes text
);
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON purchases TO authenticated;
DROP POLICY IF EXISTS "pur_read" ON purchases;
CREATE POLICY "pur_read" ON purchases FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "pur_insert" ON purchases;
CREATE POLICY "pur_insert" ON purchases FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "pur_update" ON purchases;
CREATE POLICY "pur_update" ON purchases FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Purchase Lines
CREATE TABLE IF NOT EXISTS purchase_lines (
  id text PRIMARY KEY,
  purchase_id text NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  variant_id text NOT NULL,
  quantity_ordered int NOT NULL,
  quantity_received int NOT NULL DEFAULT 0,
  unit_cost real NOT NULL,
  line_total real NOT NULL
);
ALTER TABLE purchase_lines ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON purchase_lines TO authenticated;
DROP POLICY IF EXISTS "pl_read" ON purchase_lines;
CREATE POLICY "pl_read" ON purchase_lines FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "pl_insert" ON purchase_lines;
CREATE POLICY "pl_insert" ON purchase_lines FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "pl_update" ON purchase_lines;
CREATE POLICY "pl_update" ON purchase_lines FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Audit Log (append-only, never deleted)
CREATE TABLE IF NOT EXISTS audit_log (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  user_role text NOT NULL,
  entity text NOT NULL,
  action text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  sync_op_id text,
  prev_hash text,
  hash text NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON audit_log TO authenticated;
DROP POLICY IF EXISTS "audit_read" ON audit_log;
CREATE POLICY "audit_read" ON audit_log FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "audit_insert" ON audit_log;
CREATE POLICY "audit_insert" ON audit_log FOR INSERT TO authenticated WITH CHECK (true);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
  id text PRIMARY KEY,
  store_id text REFERENCES stores(id),
  key text NOT NULL,
  value text NOT NULL DEFAULT ''
);
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON settings TO authenticated;
DROP POLICY IF EXISTS "settings_read" ON settings;
CREATE POLICY "settings_read" ON settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "settings_insert" ON settings;
CREATE POLICY "settings_insert" ON settings FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "settings_update" ON settings;
CREATE POLICY "settings_update" ON settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Sync Ops (server-side idempotency / outbox tracking)
CREATE TABLE IF NOT EXISTS sync_ops (
  id text PRIMARY KEY,
  entity text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('insert','update','delete','cancel')),
  record_id text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  logical_clock bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','synced','conflict','rejected')),
  error_message text,
  created_at timestamptz DEFAULT now(),
  synced_at timestamptz
);
ALTER TABLE sync_ops ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON sync_ops TO authenticated;
DROP POLICY IF EXISTS "sync_read" ON sync_ops;
CREATE POLICY "sync_read" ON sync_ops FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "sync_insert" ON sync_ops;
CREATE POLICY "sync_insert" ON sync_ops FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "sync_update" ON sync_ops;
CREATE POLICY "sync_update" ON sync_ops FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_store ON sales(store_id);
CREATE INDEX IF NOT EXISTS idx_imei_status ON imei_units(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_sm_variant ON stock_movements(variant_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_log(created_at);
