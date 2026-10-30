import { PGlite } from '@electric-sql/pglite';

// Incrémenter cette valeur pour rejouer le schéma/les migrations une seule fois par appareil.
const SCHEMA_VERSION = '2026-10-28.3';

let dbPromise: Promise<PGlite> | null = null;

/**
 * Ouverture unique et partagée : tous les appelants concurrents (React StrictMode, sync, pages)
 * attendent la même initialisation. Avant, le 2e appelant recevait la base avant la création
 * du schéma, ce qui provoquait des erreurs « relation does not exist » au démarrage.
 */
function getRawDb(): Promise<PGlite> {
  if (!dbPromise) {
    dbPromise = openDb().catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

async function openDb(): Promise<PGlite> {
  const db = new PGlite('idb://teleboutik-db');
  await db.waitReady;

  await db.exec(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`);
  const versionRow = await db.query<{ value: string }>("SELECT value FROM app_meta WHERE key = 'schema_version'");
  if (versionRow.rows[0]?.value === SCHEMA_VERSION) return db; // démarrage rapide : schéma déjà à jour

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

    CREATE TABLE IF NOT EXISTS airtel_transactions (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      cash_session_id TEXT NOT NULL REFERENCES cash_sessions(id),
      agent_user_id TEXT NOT NULL REFERENCES users(id),
      operation_type TEXT NOT NULL CHECK (operation_type IN ('cash_in','cash_out')),
      customer_name TEXT NOT NULL DEFAULT '',
      customer_phone TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      currency_code TEXT NOT NULL CHECK (currency_code IN ('USD','CDF')),
      reference TEXT NOT NULL UNIQUE,
      commission REAL NOT NULL DEFAULT 0 CHECK (commission >= 0),
      status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','cancelled')),
      cancel_reason TEXT NOT NULL DEFAULT '',
      cancelled_by TEXT,
      cancelled_at TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
    CREATE INDEX IF NOT EXISTS idx_airtel_transactions_date ON airtel_transactions(created_at);
    CREATE INDEX IF NOT EXISTS idx_airtel_transactions_agent ON airtel_transactions(agent_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_airtel_transactions_session ON airtel_transactions(cash_session_id);

    CREATE TABLE IF NOT EXISTS telecom_transactions (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      cash_session_id TEXT NOT NULL REFERENCES cash_sessions(id),
      agent_user_id TEXT NOT NULL REFERENCES users(id),
      service_type TEXT NOT NULL CHECK (service_type IN ('units','data_bundle')),
      operator TEXT NOT NULL CHECK (operator IN ('airtel','orange','mtn','vodacom')),
      customer_phone TEXT NOT NULL,
      service_name TEXT NOT NULL,
      face_value REAL NOT NULL CHECK (face_value > 0),
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
      cost_amount REAL NOT NULL CHECK (cost_amount >= 0),
      sale_amount REAL NOT NULL CHECK (sale_amount > 0),
      currency_code TEXT NOT NULL CHECK (currency_code IN ('USD','CDF')),
      payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','airtel_money','orange_money','mtn_momo','vodacom_money','wave','card','transfer')),
      reference TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','cancelled')),
      cancel_reason TEXT NOT NULL DEFAULT '',
      cancelled_by TEXT,
      cancelled_at TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
    CREATE INDEX IF NOT EXISTS idx_telecom_transactions_date ON telecom_transactions(created_at);
    CREATE INDEX IF NOT EXISTS idx_telecom_transactions_agent ON telecom_transactions(agent_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_telecom_transactions_session ON telecom_transactions(cash_session_id);

    CREATE TABLE IF NOT EXISTS telecom_stock (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      service_type TEXT NOT NULL CHECK (service_type IN ('units','data_bundle')),
      operator TEXT NOT NULL DEFAULT 'airtel',
      quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
      initial_quantity INTEGER NOT NULL DEFAULT 0 CHECK (initial_quantity >= 0),
      created_by TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      UNIQUE(store_id, service_type, operator)
    );
    CREATE INDEX IF NOT EXISTS idx_telecom_stock_store ON telecom_stock(store_id, service_type);

    CREATE TABLE IF NOT EXISTS sim_cards (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      operator TEXT NOT NULL CHECK (operator IN ('airtel','orange','mtn','vodacom')),
      phone_number TEXT NOT NULL,
      serial_number TEXT NOT NULL DEFAULT '',
      purchase_cost REAL NOT NULL DEFAULT 0 CHECK (purchase_cost >= 0),
      sale_price REAL NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
      currency_code TEXT NOT NULL CHECK (currency_code IN ('USD','CDF')),
      status TEXT NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock','sold','reserved','damaged','returned')),
      supplier TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      sold_at TEXT,
      sold_to TEXT,
      sold_by TEXT,
      sale_reference TEXT UNIQUE
    );
    CREATE INDEX IF NOT EXISTS idx_sim_cards_status ON sim_cards(store_id, status, operator);
    CREATE INDEX IF NOT EXISTS idx_sim_cards_phone ON sim_cards(phone_number);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sim_cards_phone_unique ON sim_cards(phone_number);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sim_cards_serial_unique ON sim_cards(serial_number) WHERE serial_number <> '';

    CREATE TABLE IF NOT EXISTS sim_stock_batches (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      operator TEXT NOT NULL DEFAULT 'airtel',
      quantity_cards INTEGER NOT NULL DEFAULT 0 CHECK (quantity_cards >= 0),
      purchase_cost_per_card REAL NOT NULL DEFAULT 0 CHECK (purchase_cost_per_card >= 0),
      sale_price_per_card REAL NOT NULL DEFAULT 0 CHECK (sale_price_per_card >= 0),
      currency_code TEXT NOT NULL CHECK (currency_code IN ('USD','CDF')),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
    CREATE INDEX IF NOT EXISTS idx_sim_stock_batches_store ON sim_stock_batches(store_id, operator);

    CREATE TABLE IF NOT EXISTS sim_batch_sales (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      cash_session_id TEXT NOT NULL REFERENCES cash_sessions(id),
      user_id TEXT NOT NULL,
      operator TEXT NOT NULL,
      quantity_cards INTEGER NOT NULL CHECK (quantity_cards IN (1,250)),
      sale_amount REAL NOT NULL,
      cost_amount REAL NOT NULL,
      currency_code TEXT NOT NULL CHECK (currency_code IN ('USD','CDF')),
      payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','airtel_money')),
      reference TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
    CREATE INDEX IF NOT EXISTS idx_sim_batch_sales_store ON sim_batch_sales(store_id, created_at);

    CREATE TABLE IF NOT EXISTS cabins (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      name TEXT NOT NULL,
      register_number INTEGER NOT NULL CHECK (register_number > 0),
      assigned_user_id TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      UNIQUE(store_id, register_number),
      UNIQUE(store_id, name)
    );

    CREATE TABLE IF NOT EXISTS commission_rules (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      service_type TEXT NOT NULL CHECK (service_type IN ('airtel_money','telecom','sim','retail')),
      rate_percent REAL NOT NULL DEFAULT 0 CHECK (rate_percent >= 0 AND rate_percent <= 100),
      fixed_amount REAL NOT NULL DEFAULT 0 CHECK (fixed_amount >= 0),
      currency_code TEXT NOT NULL DEFAULT 'CDF' CHECK (currency_code IN ('USD','CDF')),
      active BOOLEAN NOT NULL DEFAULT true,
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      UNIQUE(store_id, service_type)
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
  // Additive Airtel Money audit fields; never rewrite existing transaction history.
  await db.exec(`
    ALTER TABLE airtel_transactions ADD COLUMN IF NOT EXISTS cancel_reason TEXT NOT NULL DEFAULT '';
    ALTER TABLE airtel_transactions ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
    ALTER TABLE airtel_transactions ADD COLUMN IF NOT EXISTS cancelled_at TEXT;
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'CDF';
    ALTER TABLE sim_cards ADD COLUMN IF NOT EXISTS sold_by TEXT;
  `);
  await db.exec(`
    ALTER TABLE telecom_transactions ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE telecom_transactions ADD COLUMN IF NOT EXISTS cancel_reason TEXT NOT NULL DEFAULT '';
    ALTER TABLE telecom_transactions ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
    ALTER TABLE telecom_transactions ADD COLUMN IF NOT EXISTS cancelled_at TEXT;
  `);
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
    ALTER TABLE sale_payments ADD CONSTRAINT sale_payments_payment_method_check CHECK (payment_method IN ('cash','airtel_money','orange_money','mtn_momo','vodacom_money','wave','card','transfer','credit','voucher'));
    ALTER TABLE cash_movements DROP CONSTRAINT IF EXISTS cash_movements_payment_method_check;
    ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_payment_method_check CHECK (payment_method IN ('cash','airtel_money','orange_money','mtn_momo','vodacom_money','wave','card','transfer'));
    UPDATE cash_movements SET payment_method = 'airtel_money' WHERE movement_type = 'opening' AND payment_method = 'transfer' AND reason LIKE 'Fond virtuel%';
  `);

  // v2026-10-28.2 — migrations additives uniquement (aucune donnée existante n'est réécrite).
  await db.exec(`
    -- Référence de reçu vérifiable + empreinte d'intégrité
    ALTER TABLE sales ADD COLUMN IF NOT EXISTS receipt_ref TEXT NOT NULL DEFAULT '';
    ALTER TABLE sales ADD COLUMN IF NOT EXISTS receipt_hash TEXT NOT NULL DEFAULT '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_receipt_ref ON sales(receipt_ref) WHERE receipt_ref <> '';
    CREATE INDEX IF NOT EXISTS idx_sale_lines_imei ON sale_lines(imei_unit_id);
    CREATE INDEX IF NOT EXISTS idx_stock_imei ON stock_movements(imei_unit_id);
    -- Lien avec les clients enregistrés pour les services du shop
    ALTER TABLE airtel_transactions ADD COLUMN IF NOT EXISTS customer_id TEXT;
    ALTER TABLE telecom_transactions ADD COLUMN IF NOT EXISTS customer_id TEXT;
    ALTER TABLE telecom_transactions ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT '';
  `);

  // Modules opérationnels additionnels : garantie/SAV, dettes, rappels, sauvegardes et multi-boutiques.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS warranty_records (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, sale_id TEXT NOT NULL, sale_line_id TEXT,
      imei_unit_id TEXT, customer_id TEXT, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
      duration_months INTEGER NOT NULL DEFAULT 12, terms TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_warranty_expiry ON warranty_records(store_id, end_date, status);
    CREATE TABLE IF NOT EXISTS repair_records (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, imei_unit_id TEXT, imei TEXT NOT NULL DEFAULT '',
      customer_id TEXT, sale_id TEXT, received_at TEXT NOT NULL, returned_at TEXT,
      problem TEXT NOT NULL, diagnosis TEXT NOT NULL DEFAULT '', repair_action TEXT NOT NULL DEFAULT '',
      parts_cost REAL NOT NULL DEFAULT 0, labor_cost REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'received',
      technician TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_repair_imei ON repair_records(imei);
    CREATE TABLE IF NOT EXISTS customer_debt_ledger (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, customer_id TEXT NOT NULL, sale_id TEXT,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('debt','payment','adjustment')),
      amount REAL NOT NULL, currency_code TEXT NOT NULL DEFAULT 'CDF', due_date TEXT,
      reference TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_customer_debt ON customer_debt_ledger(store_id, customer_id, due_date);
    CREATE TABLE IF NOT EXISTS debt_reminders (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, customer_id TEXT NOT NULL, sale_id TEXT,
      channel TEXT NOT NULL CHECK(channel IN ('sms','whatsapp','manual')), scheduled_at TEXT NOT NULL,
      sent_at TEXT, status TEXT NOT NULL DEFAULT 'pending', message TEXT NOT NULL, provider_ref TEXT,
      created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS backup_records (
      id TEXT PRIMARY KEY, backup_date TEXT NOT NULL, format TEXT NOT NULL, encrypted BOOLEAN NOT NULL DEFAULT true,
      payload TEXT NOT NULL, checksum TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS store_memberships (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true, UNIQUE(store_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS stock_restock_suggestions (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, variant_id TEXT NOT NULL, current_stock REAL NOT NULL,
      minimum_stock REAL NOT NULL, suggested_quantity REAL NOT NULL, status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(store_id,variant_id,status)
    );
    CREATE TABLE IF NOT EXISTS manager_approvals (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT,
      requested_by TEXT NOT NULL, approved_by TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(
    "INSERT INTO app_meta (key, value) VALUES ('schema_version', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [SCHEMA_VERSION]
  );
  return db;
}

// ---------------------------------------------------------------------------
// Verrou de transactions locales
//
// PGlite n'a qu'UNE connexion : un BEGIN … COMMIT couvre plusieurs `await`, et pendant ce temps
// n'importe quelle autre écriture (synchronisation cloud, autre page, journal d'audit) passait
// dans la même transaction — validée ou annulée avec elle par erreur.
//
// Règles :
//  - Chaque appel à getDb() renvoie un accès (« handle ») avec son propre état.
//  - Un BEGIN (ou db.transaction) prend le verrou : un seul propriétaire à la fois, file FIFO.
//  - Tant qu'un handle possède le verrou, les requêtes des AUTRES handles attendent la fin de la
//    transaction. Elles ne sont ni incluses dans le COMMIT ni annulées par le ROLLBACK.
//  - Un BEGIN attend aussi que les requêtes déjà parties des autres handles soient terminées.
//  - COMMIT / ROLLBACK envoyés par un handle qui ne possède pas le verrou sont ignorés
//    (ils toucheraient la transaction d'un autre).
//  - Anti-blocage : une transaction manuelle gardée plus de 60 s est annulée de force ; une attente
//    de plus de 30 s derrière elle échoue avec un message clair. Les transactions natives
//    (db.transaction de la synchronisation, parfois longues) ne sont ni forcées ni limitées.
// ---------------------------------------------------------------------------

const LOCK_WAIT_TIMEOUT_MS = 30_000;
const LOCK_MAX_HOLD_MS = 60_000;

interface DeferredSync { tableName: string; recordId: string | null; queueValue: 'upsert' | 'delete' }
interface HandleState { label: string; inTx: boolean; native: boolean; deferred: DeferredSync[] }
interface Handle { state: HandleState; db: PGlite }

let lockOwner: HandleState | null = null;
let lockSince = 0;
let inflightOutsideStatements = 0;
let lockWaiters: Array<() => void> = [];

function wakeWaiters(): void {
  const waiters = lockWaiters;
  lockWaiters = [];
  for (const wake of waiters) wake();
}

function releaseLock(state: HandleState): void {
  if (lockOwner === state) {
    lockOwner = null;
    state.inTx = false;
    state.native = false;
    wakeWaiters();
  }
}

/**
 * Attend que `canProceed()` soit vrai, puis exécute `take()` dans le même tick (aucune course possible
 * entre le test et la prise du verrou / du compteur).
 */
async function acquireWhen(canProceed: () => boolean, take: () => void, what: string): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    if (canProceed()) { take(); return; }
    const owner = lockOwner;
    if (owner && !owner.native && Date.now() - lockSince > LOCK_MAX_HOLD_MS) {
      console.error(`[localDb] Transaction « ${owner.label} » gardée plus de ${LOCK_MAX_HOLD_MS / 1000} s : annulation forcée pour débloquer la base.`);
      try { const raw = await getRawDb(); await raw.exec('ROLLBACK'); } catch (error) { console.warn('[localDb] ROLLBACK forcé impossible', error); }
      owner.deferred.length = 0;
      releaseLock(owner);
      continue;
    }
    const bounded = !owner || !owner.native;
    const remaining = LOCK_WAIT_TIMEOUT_MS - (Date.now() - startedAt);
    if (bounded && remaining <= 0) {
      throw new Error(`Base locale occupée par une autre opération (${what}). Réessaie dans un instant.`);
    }
    await new Promise<void>((resolve) => {
      const timer = bounded ? setTimeout(resolve, Math.max(50, remaining)) : null;
      lockWaiters.push(() => { if (timer) clearTimeout(timer); resolve(); });
    });
  }
}

const BEGIN_RE = /^\s*(BEGIN|START\s+TRANSACTION)\b/i;
const COMMIT_RE = /^\s*(COMMIT|END)\s*;?\s*$/i;
const ROLLBACK_RE = /^\s*ROLLBACK\s*;?\s*$/i;

async function guardedCall<T>(state: HandleState, sql: unknown, op: () => Promise<T>): Promise<T> {
  const text = typeof sql === 'string' ? sql : '';

  if (BEGIN_RE.test(text)) {
    if (lockOwner === state) throw new Error('Une transaction locale est déjà ouverte sur cet accès (BEGIN imbriqué interdit).');
    await acquireWhen(
      () => lockOwner === null && inflightOutsideStatements === 0,
      () => { lockOwner = state; lockSince = Date.now(); state.label = text.trim().slice(0, 40); },
      'ouverture de transaction'
    );
    try {
      const result = await op();
      state.inTx = true;
      return result;
    } catch (error) {
      releaseLock(state);
      throw error;
    }
  }

  if (COMMIT_RE.test(text) || ROLLBACK_RE.test(text)) {
    if (lockOwner !== state) {
      console.warn(`[localDb] ${text.trim()} ignoré : cet accès ne possède aucune transaction ouverte.`);
      return undefined as T;
    }
    try {
      return await op();
    } catch (error) {
      try { const raw = await getRawDb(); await raw.exec('ROLLBACK'); } catch { /* la transaction est déjà fermée */ }
      throw error;
    } finally {
      releaseLock(state);
    }
  }

  let counted = false;
  await acquireWhen(
    () => lockOwner === null || lockOwner === state,
    () => { if (lockOwner === null) { inflightOutsideStatements += 1; counted = true; } },
    'requête'
  );
  try {
    return await op();
  } finally {
    if (counted) { inflightOutsideStatements -= 1; wakeWaiters(); }
  }
}

function createHandle(raw: PGlite, label: string): Handle {
  const state: HandleState = { label, inTx: false, native: false, deferred: [] };
  const db = new Proxy(raw, {
    get(target, prop) {
      if (prop === 'query' || prop === 'exec') {
        const method = Reflect.get(target, prop) as (...args: unknown[]) => Promise<unknown>;
        return (...args: unknown[]) => guardedCall(state, args[0], () => Reflect.apply(method, target, args));
      }
      if (prop === 'transaction') {
        // Transaction native PGlite (synchronisation) : même verrou, tenu pendant tout le callback.
        const method = Reflect.get(target, prop) as (...args: unknown[]) => Promise<unknown>;
        return async (...args: unknown[]) => {
          await acquireWhen(
            () => lockOwner === null && inflightOutsideStatements === 0,
            () => { lockOwner = state; lockSince = Date.now(); state.native = true; state.label = 'db.transaction'; },
            'transaction'
          );
          try { return await Reflect.apply(method, target, args); } finally { releaseLock(state); }
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as PGlite;
  return { state, db };
}

/** Accès à la base. Chaque appel renvoie un accès distinct : BEGIN / COMMIT / ROLLBACK passés dessus sont protégés par le verrou. */
export async function getDb(): Promise<PGlite> {
  return createHandle(await getRawDb(), 'getDb').db;
}

let globalHandlePromise: Promise<Handle> | null = null;
function getGlobalHandle(): Promise<Handle> {
  if (!globalHandlePromise) globalHandlePromise = getRawDb().then((raw) => createHandle(raw, 'global'));
  return globalHandlePromise;
}

function scheduleDeferred(items: DeferredSync[]): void {
  for (const item of items) {
    void import('./syncEngine').then(({ scheduleLocalTableSync }) => scheduleLocalTableSync(item.tableName, item.recordId, item.queueValue))
      .catch((error) => console.warn('Cloud sync scheduler unavailable:', error));
  }
}

async function queryOn<T>(handle: Handle, sql: string, params?: unknown[]): Promise<T[]> {
  const result = await handle.db.query(sql, params ?? []);
  return (result.rows ?? []) as T[];
}

async function executeOn(handle: Handle, sql: string, params?: unknown[]): Promise<void> {
  const database = handle.db;
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
  const queueValue: 'delete' | 'upsert' = isDelete ? 'delete' : 'upsert';
  try {
    await database.query(
      `INSERT INTO app_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [queueKey, queueValue]
    );
  } catch (error) {
    console.warn('Unable to persist cloud sync queue:', error);
  }
  if (handle.state.inTx) {
    handle.state.deferred.push({ tableName, recordId, queueValue });
  } else {
    scheduleDeferred([{ tableName, recordId, queueValue }]);
  }
}

/** Opérations disponibles à l'intérieur de withLocalTransaction. */
export interface LocalTx {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

function txApi(handle: Handle): LocalTx {
  const query = <T,>(sql: string, params?: unknown[]) => queryOn<T>(handle, sql, params);
  return {
    query,
    queryOne: async <T,>(sql: string, params?: unknown[]) => (await query<T>(sql, params))[0] ?? null,
    execute: (sql, params) => executeOn(handle, sql, params),
  };
}

/**
 * Exécute `fn` dans une transaction locale isolée : COMMIT si elle réussit, ROLLBACK si elle échoue.
 * `fn` doit utiliser les fonctions de `tx` (pas les query/execute globales, qui attendraient la fin de la transaction).
 * Le verrou est toujours relâché, même en cas d'erreur.
 */
export async function withLocalTransaction<T>(fn: (tx: LocalTx) => Promise<T>): Promise<T> {
  const handle = createHandle(await getRawDb(), 'withLocalTransaction');
  await handle.db.exec('BEGIN');
  let result: T;
  try {
    result = await fn(txApi(handle));
    await handle.db.exec('COMMIT');
  } catch (error) {
    try { await handle.db.exec('ROLLBACK'); } catch (rollbackError) { console.warn('[localDb] ROLLBACK impossible', rollbackError); }
    handle.state.deferred.length = 0;
    throw error;
  }
  scheduleDeferred(handle.state.deferred.splice(0));
  return result;
}

/**
 * API historique. Elle prend le même verrou, mais les requêtes globales (query/execute) émises par d'AUTRES
 * traitements pendant la transaction ne peuvent pas être distinguées : préférer withLocalTransaction.
 */
export async function beginLocalTransaction(): Promise<void> {
  const handle = await getGlobalHandle();
  await handle.db.exec('BEGIN');
}

export async function commitLocalTransaction(): Promise<void> {
  const handle = await getGlobalHandle();
  if (!handle.state.inTx) { console.warn('[localDb] commitLocalTransaction ignoré : aucune transaction ouverte.'); return; }
  await handle.db.exec('COMMIT');
  scheduleDeferred(handle.state.deferred.splice(0));
}

export async function rollbackLocalTransaction(): Promise<void> {
  const handle = await getGlobalHandle();
  try { await handle.db.exec('ROLLBACK'); } finally { handle.state.deferred.length = 0; }
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  return queryOn<T>(await getGlobalHandle(), sql, params);
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params?: unknown[]): Promise<void> {
  return executeOn(await getGlobalHandle(), sql, params);
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
