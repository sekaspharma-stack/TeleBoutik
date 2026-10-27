import { PGlite } from '@electric-sql/pglite';

let db: PGlite | null = null;

export async function getDb(): Promise<PGlite> {
  if (db) return db;

  db = new PGlite('idb://teleboutik-db');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'XOF',
      currency_decimals INTEGER NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
      tax_enabled BOOLEAN NOT NULL DEFAULT false,
      max_seller_discount REAL NOT NULL DEFAULT 5,
      max_manager_discount REAL NOT NULL DEFAULT 10,
      credit_limit_default REAL NOT NULL DEFAULT 50000,
      return_window_days INTEGER NOT NULL DEFAULT 7,
      ticket_width TEXT NOT NULL DEFAULT '58',
      footer_text TEXT NOT NULL DEFAULT 'Merci de votre visite!'
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pin TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner','manager','seller','accountant')),
      active BOOLEAN NOT NULL DEFAULT true,
      commission_rate REAL NOT NULL DEFAULT 0,
      fixed_salary REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      brand TEXT NOT NULL,
      family TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL,
      category TEXT NOT NULL,
      image_url TEXT,
      is_serialized BOOLEAN NOT NULL DEFAULT false,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );

    CREATE TABLE IF NOT EXISTS product_variants (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      sku TEXT NOT NULL UNIQUE,
      barcode TEXT NOT NULL DEFAULT '',
      attributes TEXT NOT NULL DEFAULT '{}',
      purchase_price REAL NOT NULL DEFAULT 0,
      sale_price REAL NOT NULL DEFAULT 0,
      wholesale_price REAL NOT NULL DEFAULT 0,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      min_stock INTEGER NOT NULL DEFAULT 5,
      max_stock INTEGER NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );

    CREATE TABLE IF NOT EXISTS imei_units (
      id TEXT PRIMARY KEY,
      variant_id TEXT NOT NULL REFERENCES product_variants(id),
      imei1 TEXT NOT NULL,
      imei2 TEXT,
      serial_number TEXT,
      lifecycle_status TEXT NOT NULL DEFAULT 'in_stock' CHECK (lifecycle_status IN ('ordered','received','in_stock','sold','returned','repair','traded_in','retired')),
      cost REAL NOT NULL DEFAULT 0,
      grade TEXT CHECK (grade IN ('new','A','B','C') OR grade IS NULL),
      received_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      sold_at TEXT,
      notes TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_imei_variant ON imei_units(variant_id);
    CREATE INDEX IF NOT EXISTS idx_imei_status ON imei_units(lifecycle_status);
    CREATE INDEX IF NOT EXISTS idx_imei1 ON imei_units(imei1);

    CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      variant_id TEXT NOT NULL REFERENCES product_variants(id),
      imei_unit_id TEXT,
      movement_type TEXT NOT NULL CHECK (movement_type IN ('purchase','sale','return','adjustment','inventory','transfer','loss','repair')),
      direction TEXT NOT NULL CHECK (direction IN ('in','out')),
      quantity INTEGER NOT NULL,
      unit_cost REAL NOT NULL DEFAULT 0,
      reference_type TEXT NOT NULL DEFAULT '',
      reference_id TEXT,
      user_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );

    CREATE INDEX IF NOT EXISTS idx_stock_variant ON stock_movements(variant_id);

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT,
      credit_limit REAL NOT NULL DEFAULT 50000,
      outstanding_balance REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT,
      address TEXT,
      payment_terms TEXT NOT NULL DEFAULT 'comptant',
      balance REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      ticket_number TEXT NOT NULL,
      store_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      customer_id TEXT,
      subtotal REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','cancelled','on_credit','pending')),
      sale_date TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      notes TEXT,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      exchange_rate REAL NOT NULL DEFAULT 1,
      exchange_rate_buy REAL NOT NULL DEFAULT 1,
      change_currency TEXT NOT NULL DEFAULT 'USD',
      change_amount REAL NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
    CREATE INDEX IF NOT EXISTS idx_sales_user ON sales(user_id);
    CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);

    CREATE TABLE IF NOT EXISTS sale_lines (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      variant_id TEXT NOT NULL,
      imei_unit_id TEXT,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      unit_cost REAL NOT NULL,
      discount REAL NOT NULL DEFAULT 0,
      line_total REAL NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sale_lines_sale ON sale_lines(sale_id);

    CREATE TABLE IF NOT EXISTS sale_payments (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','orange_money','mtn_momo','wave','card','transfer','credit','voucher')),
      amount REAL NOT NULL,
      reference TEXT,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      original_amount REAL NOT NULL DEFAULT 0,
      applied_rate REAL NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON sale_payments(sale_id);

    CREATE TABLE IF NOT EXISTS cash_sessions (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      register_number INTEGER NOT NULL DEFAULT 1,
      opening_amount REAL NOT NULL DEFAULT 0,
      closing_amount REAL,
      expected_closing REAL,
      difference REAL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
      opened_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      closed_at TEXT,
      notes TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_cash_session_user ON cash_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_cash_session_status ON cash_sessions(status);

    CREATE TABLE IF NOT EXISTS cash_movements (
      id TEXT PRIMARY KEY,
      cash_session_id TEXT NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
      movement_type TEXT NOT NULL CHECK (movement_type IN ('sale','expense','deposit','withdrawal','adjustment','opening')),
      payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','orange_money','mtn_momo','wave','card','transfer')),
      amount REAL NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('in','out')),
      reference_type TEXT NOT NULL DEFAULT '',
      reference_id TEXT,
      user_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      currency_code TEXT NOT NULL DEFAULT 'USD',
      original_amount REAL NOT NULL DEFAULT 0,
      applied_rate REAL NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_cash_mov_session ON cash_movements(cash_session_id);

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'cash',
      description TEXT NOT NULL DEFAULT '',
      receipt_url TEXT,
      expense_date TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );

    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);

    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      account_debit TEXT NOT NULL,
      account_credit TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      reference_type TEXT NOT NULL DEFAULT '',
      reference_id TEXT NOT NULL DEFAULT '',
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );

    CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries(date);

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_role TEXT NOT NULL,
      entity TEXT NOT NULL,
      action TEXT NOT NULL,
      before_data TEXT,
      after_data TEXT,
      sync_op_id TEXT,
      prev_hash TEXT,
      hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );

    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity);
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_log(created_at);

    CREATE TABLE IF NOT EXISTS sync_ops (
      id TEXT PRIMARY KEY,
      entity TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('insert','update','delete','cancel')),
      record_id TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      logical_clock INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','synced','conflict','rejected')),
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      synced_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_ops(status);

    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS currency_exchanges (
      id TEXT PRIMARY KEY,
      cash_session_id TEXT,
      user_id TEXT NOT NULL,
      usd_amount REAL NOT NULL,
      cdf_amount REAL NOT NULL,
      applied_rate REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      notes TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_currency_exchanges_date ON currency_exchanges(created_at);

    CREATE TABLE IF NOT EXISTS credit_plans (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL REFERENCES sales(id),
      customer_id TEXT NOT NULL,
      total_amount REAL NOT NULL,
      initial_payment REAL NOT NULL DEFAULT 0,
      remaining_amount REAL NOT NULL,
      installments_count INTEGER NOT NULL DEFAULT 3,
      installment_amount REAL NOT NULL,
      frequency_days INTEGER NOT NULL DEFAULT 30,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paid','late')),
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );

    CREATE TABLE IF NOT EXISTS credit_installments (
      id TEXT PRIMARY KEY,
      credit_plan_id TEXT NOT NULL REFERENCES credit_plans(id) ON DELETE CASCADE,
      installment_number INTEGER NOT NULL,
      amount REAL NOT NULL,
      due_date TEXT NOT NULL,
      paid_amount REAL NOT NULL DEFAULT 0,
      paid_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','late'))
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      reference TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ordered','partial','received','cancelled')),
      total_amount REAL NOT NULL DEFAULT 0,
      paid_amount REAL NOT NULL DEFAULT 0,
      extra_costs REAL NOT NULL DEFAULT 0,
      order_date TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      received_date TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS purchase_lines (
      id TEXT PRIMARY KEY,
      purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      variant_id TEXT NOT NULL,
      quantity_ordered INTEGER NOT NULL,
      quantity_received INTEGER NOT NULL DEFAULT 0,
      unit_cost REAL NOT NULL,
      line_total REAL NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_purchase_lines_purchase ON purchase_lines(purchase_id);

    CREATE TABLE IF NOT EXISTS inventory_sessions (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','validated')),
      started_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      validated_at TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS trade_ins (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      variant_id TEXT,
      imei1 TEXT NOT NULL,
      imei2 TEXT,
      brand TEXT NOT NULL,
      model TEXT NOT NULL,
      checklist TEXT NOT NULL DEFAULT '{}',
      photos TEXT NOT NULL DEFAULT '[]',
      estimated_cost REAL NOT NULL DEFAULT 0,
      grade TEXT NOT NULL DEFAULT 'C' CHECK (grade IN ('A','B','C')),
      status TEXT NOT NULL DEFAULT 'evaluated' CHECK (status IN ('evaluated','in_stock','sold','rejected')),
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );
  `);

  // Safe, additive migrations for existing offline databases. Preserve the currency that existing products used before per-product currency was introduced.
  const variantCurrencyColumn = await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'product_variants' AND column_name = 'currency_code'");
  if (variantCurrencyColumn.rows.length === 0) {
    await db.exec("ALTER TABLE product_variants ADD COLUMN currency_code TEXT NOT NULL DEFAULT 'USD'; UPDATE product_variants SET currency_code = COALESCE((SELECT currency FROM stores LIMIT 1), 'CDF');");
  }
  // Other migrations only add metadata and do not touch stock or historical totals.
  await db.exec(`
    ALTER TABLE sales ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'USD';
    ALTER TABLE sales ADD COLUMN IF NOT EXISTS exchange_rate REAL NOT NULL DEFAULT 1;
    ALTER TABLE sales ADD COLUMN IF NOT EXISTS exchange_rate_buy REAL NOT NULL DEFAULT 1;
    ALTER TABLE sales ADD COLUMN IF NOT EXISTS change_currency TEXT NOT NULL DEFAULT 'USD';
    ALTER TABLE sales ADD COLUMN IF NOT EXISTS change_amount REAL NOT NULL DEFAULT 0;
    ALTER TABLE sale_payments ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'USD';
    ALTER TABLE sale_payments ADD COLUMN IF NOT EXISTS original_amount REAL NOT NULL DEFAULT 0;
    ALTER TABLE sale_payments ADD COLUMN IF NOT EXISTS applied_rate REAL NOT NULL DEFAULT 1;
    ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'USD';
    ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS original_amount REAL NOT NULL DEFAULT 0;
    ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS applied_rate REAL NOT NULL DEFAULT 1;
    ALTER TABLE sale_payments DROP CONSTRAINT IF EXISTS sale_payments_payment_method_check;
    ALTER TABLE sale_payments ADD CONSTRAINT sale_payments_payment_method_check CHECK (payment_method IN ('cash','airtel_money','orange_money','mtn_momo','wave','card','transfer','credit','voucher'));
    ALTER TABLE cash_movements DROP CONSTRAINT IF EXISTS cash_movements_payment_method_check;
    ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_payment_method_check CHECK (payment_method IN ('cash','airtel_money','orange_money','mtn_momo','wave','card','transfer'));
    UPDATE cash_movements SET payment_method = 'airtel_money' WHERE movement_type = 'opening' AND payment_method = 'transfer' AND reason LIKE 'Fond virtuel%';
  `);

  return db;
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const database = await getDb();
  const result = await database.query(sql, params ?? []);
  return (result.rows ?? []) as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params?: unknown[]): Promise<void> {
  const database = await getDb();
  const values = params ?? [];
  await database.query(sql, values);

  // Persist cloud work in app_meta so offline changes survive a page reload.
  // Internal sync tables are excluded to prevent recursive queue creation.
  const match = sql.trim().match(/^(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*)/i);
  const operationKind = match?.[1]?.toUpperCase();
  const tableName = match?.[2]?.toLowerCase();
  if (!tableName || tableName === 'sync_ops' || tableName === 'app_meta') return;

  let recordId: string | null = null;
  if (operationKind === 'INSERT INTO') {
    const firstValue = sql.match(/\bVALUES\s*\(\s*\$(\d+)/i);
    if (firstValue) recordId = String(values[Number(firstValue[1]) - 1] ?? '') || null;
  } else {
    const idParam = sql.match(/\bWHERE\s+(?:[a-z_][a-z0-9_]*\.)?id\s*=\s*\$(\d+)/i);
    if (idParam) recordId = String(values[Number(idParam[1]) - 1] ?? '') || null;
  }

  const isDelete = operationKind === 'DELETE FROM';
  const queueKey = recordId
    ? `cloud_pending:${tableName}:${recordId}`
    : `cloud_pending_full:${tableName}`;
  const queueValue = isDelete ? 'delete' : 'upsert';
  try {
    await database.query(
      `INSERT INTO app_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [queueKey, queueValue]
    );
  } catch (error) {
    console.warn('Unable to persist cloud sync queue:', error);
  }
  void import('./syncEngine')
    .then(({ scheduleLocalTableSync }) => scheduleLocalTableSync(tableName, recordId, queueValue))
    .catch((error) => console.warn('Cloud sync scheduler unavailable:', error));
}

export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function now(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}
