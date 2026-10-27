import { query, queryOne, execute, generateId, now } from './localDb';

const SEED_FLAG_KEY = 'seed_v2_done';

async function isSeeded(): Promise<boolean> {
  const row = await queryOne<{ value: string }>("SELECT value FROM app_meta WHERE key = $1", [SEED_FLAG_KEY]);
  return row?.value === '1';
}

async function markSeeded(): Promise<void> {
  await execute("INSERT INTO app_meta (key, value) VALUES ($1, '1')", [SEED_FLAG_KEY]);
}

function randomImei(): string {
  const prefix = '35';
  let code = prefix;
  for (let i = 0; i < 13; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
}

function randomBarcode(): string {
  const prefix = '200';
  let code = prefix;
  for (let i = 0; i < 9; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = parseInt(code[i], 10);
    sum += i % 2 === 0 ? d : d * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return code + check.toString();
}

function randomSku(brand: string, model: string, suffix: string): string {
  const b = brand.substring(0, 3).toUpperCase();
  const m = model.substring(0, 4).toUpperCase().replace(/\s/g, '');
  const s = suffix.substring(0, 4).toUpperCase().replace(/\s/g, '');
  const r = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
  return `${b}-${m}-${s}-${r}`;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(Math.floor(Math.random() * 12) + 8, Math.floor(Math.random() * 59));
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

export async function seedDemoData(): Promise<void> {
  if (await isSeeded()) return;

  // Do not restart the demo seed if a previous attempt was interrupted,
  // or if this browser already contains real store data.
  const existingStore = await queryOne<{ id: string }>('SELECT id FROM stores LIMIT 1');
  if (existingStore) {
    await markSeeded();
    return;
  }

  const storeId = generateId();
  await execute(
    `INSERT INTO stores (id, name, address, phone, currency, currency_decimals, tax_rate, tax_enabled, max_seller_discount, max_manager_discount, credit_limit_default, return_window_days, ticket_width, footer_text)
     VALUES ($1, 'TeleShop Abidjan', 'Cocody Angré, Abidjan', '+225 07 00 11 22', 'XOF', 0, 0, false, 5, 10, 50000, 7, '58', 'Merci de votre visite!')`,
    [storeId]
  );

  const users = [
    { id: generateId(), name: 'Propriétaire', pin: '0000', role: 'owner', commission: 0, salary: 0 },
    { id: generateId(), name: 'Awa Gérante', pin: '1111', role: 'manager', commission: 2, salary: 100000 },
    { id: generateId(), name: 'Moussa Vendeur', pin: '2222', role: 'seller', commission: 1, salary: 50000 },
    { id: generateId(), name: 'Koffi Vendeur', pin: '3333', role: 'seller', commission: 1, salary: 50000 },
    { id: generateId(), name: 'Comptable', pin: '4444', role: 'accountant', commission: 0, salary: 80000 },
  ];
  for (const u of users) {
    await execute(
      `INSERT INTO users (id, name, pin, role, active, commission_rate, fixed_salary, created_at)
       VALUES ($1, $2, $3, $4, true, $5, $6, $7)`,
      [u.id, u.name, u.pin, u.role, u.commission, u.salary, now()]
    );
  }

  const phoneBrands = [
    { brand: 'Samsung', models: ['Galaxy A15', 'Galaxy A25', 'Galaxy A35', 'Galaxy S24', 'Galaxy A05'] },
    { brand: 'Tecno', models: ['Spark 20', 'Camon 30', 'Spark 10', 'Phantom V', 'Pop 8'] },
    { brand: 'Infinix', models: ['Hot 40', 'Note 30', 'Smart 8', 'Zero 30', 'Hot 30'] },
    { brand: 'iPhone', models: ['iPhone 13', 'iPhone 14', 'iPhone 15', 'iPhone 11', 'iPhone 12'] },
    { brand: 'Xiaomi', models: ['Redmi 13', 'Redmi Note 13', 'Redmi 12', 'Poco X6', 'Mi 14'] },
    { brand: 'Itel', models: ['A70', 'P55', 'A60', 'Vision 5'] },
  ];
  const colors = ['Noir', 'Bleu', 'Vert', 'Violet', 'Or', 'Blanc'];
  const capacities = ['64 Go', '128 Go', '256 Go'];

  const accessoryTypes = [
    { category: 'coque', models: ['Coque silicone', 'Coque cuir', 'Coque transparente', 'Coque anti-choc'] },
    { category: 'écouteur', models: ['Écouteurs filaires', 'Écouteurs Bluetooth', 'AirPods clone'] },
    { category: 'câble', models: ['Câble USB-C 1m', 'Câble Lightning 1m', 'Câble USB-C 2m', 'Câble micro-USB'] },
    { category: 'chargeur', models: ['Chargeur rapide 20W', 'Chargeur classique 10W', 'Chargeur voiture'] },
    { category: 'casque', models: ['Casque Bluetooth', 'Casque gaming'] },
    { category: 'vitres', models: ['Vitre trempée', 'Film protection'] },
    { category: 'powerbank', models: ['Powerbank 10000mAh', 'Powerbank 20000mAh', 'Powerbank 5000mAh'] },
    { category: 'batterie', models: ['Batterie Samsung', 'Batterie iPhone', 'Batterie universelle'] },
  ];
  const accessoryBrands = ['Generic', 'Oraimo', 'Anker', 'Belkin', 'Baseus'];

  const phoneCompatibility = ['iPhone 15', 'iPhone 14', 'Samsung A15', 'Tecno Spark 20', 'Universal'];

  const sellerIds = users.filter((u) => u.role === 'seller' || u.role === 'manager').map((u) => u.id);
  const sellerName = (id: string) => users.find((u) => u.id === id)?.name ?? 'Inconnu';

  // Phones
  const phoneProducts: Array<{ productId: string; variantId: string; purchasePrice: number; salePrice: number; brand: string; model: string }> = [];
  let phonesCreated = 0;
  while (phonesCreated < 20) {
    for (const b of phoneBrands) {
      if (phonesCreated >= 60) break;
      for (const model of b.models) {
        if (phonesCreated >= 60) break;
        const color = pick(colors);
        const capacity = pick(capacities);
        const purchasePrice = Math.floor(Math.random() * 40000) + 30000;
        const salePrice = purchasePrice + Math.floor(Math.random() * 25000) + 10000;

        const productId = generateId();
        const variantId = generateId();
        await execute(
          `INSERT INTO products (id, brand, family, model, category, is_serialized, created_at, updated_at)
           VALUES ($1, $2, 'smartphone', $3, 'telephone', true, $4, $5)`,
          [productId, b.brand, model, now(), now()]
        );
        await execute(
          `INSERT INTO product_variants (id, product_id, sku, barcode, attributes, purchase_price, sale_price, wholesale_price, min_stock, max_stock, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 2, 20, $9, $10)`,
          [variantId, productId, randomSku(b.brand, model, `${color}-${capacity}`), randomBarcode(),
           JSON.stringify({ Couleur: color, Capacité: capacity, État: 'Neuf' }),
           purchasePrice, salePrice, salePrice - 5000, now(), now()]
        );

        // Add 1-3 IMEI units per variant
        const imeiCount = Math.floor(Math.random() * 3) + 1;
        for (let j = 0; j < imeiCount && phonesCreated < 60; j++) {
          const imeiId = generateId();
          const imei = randomImei();
          const daysAgo = Math.floor(Math.random() * 60);
          await execute(
            `INSERT INTO imei_units (id, variant_id, imei1, imei2, lifecycle_status, cost, grade, received_at)
             VALUES ($1, $2, $3, $4, 'in_stock', $5, 'new', $6)`,
            [imeiId, variantId, imei, Math.random() > 0.5 ? randomImei() : null, purchasePrice, randomDate(daysAgo)]
          );
          await execute(
            `INSERT INTO stock_movements (id, variant_id, imei_unit_id, movement_type, direction, quantity, unit_cost, reference_type, user_id, reason, created_at)
             VALUES ($1, $2, $3, 'purchase', 'in', 1, $4, 'seed', $5, 'Réception initiale', $6)`,
            [generateId(), variantId, imeiId, purchasePrice, users[0].id, randomDate(daysAgo)]
          );
          phonesCreated++;
        }
        phoneProducts.push({ productId, variantId, purchasePrice, salePrice, brand: b.brand, model });
      }
    }
  }

  // Accessories (300 variants)
  let accessoryCount = 0;
  while (accessoryCount < 60) {
    for (const at of accessoryTypes) {
      for (const model of at.models) {
        if (accessoryCount >= 300) break;
        for (const brand of accessoryBrands) {
          if (accessoryCount >= 300) break;
          for (const compat of phoneCompatibility) {
            if (accessoryCount >= 300) break;
            const color = pick(colors);
            const purchasePrice = Math.floor(Math.random() * 3000) + 500;
            const salePrice = purchasePrice + Math.floor(Math.random() * 4000) + 1000;
            const stockQty = Math.floor(Math.random() * 30) + 5;

            const productId = generateId();
            const variantId = generateId();
            await execute(
              `INSERT INTO products (id, brand, family, model, category, is_serialized, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, false, $6, $7)`,
              [productId, brand, at.category, model, at.category, now(), now()]
            );
            await execute(
              `INSERT INTO product_variants (id, product_id, sku, barcode, attributes, purchase_price, sale_price, wholesale_price, min_stock, max_stock, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 5, 50, $9, $10)`,
              [variantId, productId, randomSku(brand, model, `${compat}-${color}`), randomBarcode(),
               JSON.stringify({ Couleur: color, 'Compatibilité': compat, Qualité: pick(['Original', 'Copie']) }),
               purchasePrice, salePrice, salePrice - 500, now(), now()]
            );
            await execute(
              `INSERT INTO stock_movements (id, variant_id, movement_type, direction, quantity, unit_cost, reference_type, user_id, reason, created_at)
               VALUES ($1, $2, 'purchase', 'in', $3, $4, 'seed', $5, 'Stock initial', $6)`,
              [generateId(), variantId, stockQty, purchasePrice, users[0].id, randomDate(60)]
            );
            accessoryCount++;
          }
        }
      }
    }
  }

  // Customers
  const customerNames = [
    'Moussa Diallo', 'Awa Koné', 'Koffi Adjoua', 'Fatou Bamba', 'Ibrahim Touré',
    'Sandra Aka', 'Yacouba Coulibaly', 'Adjoa Mensah', 'Seydou Ouattara', 'Mariam Cissé',
    "Jean Kouadio", "Grace N'Guessan", 'Ousmane Diarra', 'Aminata Sangaré', 'Boubacar Sidibé',
  ];
  const customers: Array<{ id: string; name: string }> = [];
  for (const name of customerNames) {
    const id = generateId();
    const phone = `+225 0${Math.floor(Math.random() * 9) + 1} ${Math.floor(Math.random() * 90) + 10} ${Math.floor(Math.random() * 90) + 10} ${Math.floor(Math.random() * 90) + 10}`;
    await execute(
      `INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, created_at)
       VALUES ($1, $2, $3, 50000, 0, $4)`,
      [id, name, phone, randomDate(30)]
    );
    customers.push({ id, name });
  }

  // Suppliers
  const suppliers = ['TechImport SARL', 'Phone Wholesale CI', 'Accessoires Pro', 'Dubai Mobile Trading', 'Cocody Telecom'];
  for (const s of suppliers) {
    await execute(
      `INSERT INTO suppliers (id, name, phone, payment_terms, balance, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [generateId(), s, `+225 0${Math.floor(Math.random() * 9) + 1} 00 00 00`, pick(['comptant', '30 jours', '15 jours']), Math.floor(Math.random() * 500000), randomDate(60)]
    );
  }

  // 30 days of sales history
  const allVariants = await query<{ id: string; product_id: string; purchase_price: number; sale_price: number; product_name: string; is_serialized: boolean }>(
    `SELECT pv.id, pv.product_id, pv.purchase_price, pv.sale_price,
       (p.brand || ' ' || p.model) as product_name, p.is_serialized
     FROM product_variants pv JOIN products p ON p.id = pv.product_id`
  );

  const paymentMethods = ['cash', 'orange_money', 'mtn_momo', 'wave', 'cash', 'cash', 'cash', 'card'];

  for (let day = 15; day >= 1; day--) {
    const salesPerDay = Math.floor(Math.random() * 3) + 1;
    for (let s = 0; s < salesPerDay; s++) {
      const saleId = generateId();
      const dateStr = randomDate(day);
      const datePrefix = dateStr.substring(0, 10).replace(/-/g, '');
      const ticketNum = `${datePrefix}-${String(s + 1).padStart(4, '0')}`;
      const sellerId = pick(sellerIds);
      const customerId = Math.random() > 0.7 ? pick(customers).id : null;

      // 1-3 line items
      const lineCount = Math.floor(Math.random() * 3) + 1;
      let subtotal = 0;
      let totalCost = 0;
      const lines: Array<{ variantId: string; name: string; qty: number; price: number; cost: number }> = [];

      for (let l = 0; l < lineCount; l++) {
        const variant = pick(allVariants);
        const price = variant.sale_price;
        const cost = variant.purchase_price;
        lines.push({ variantId: variant.id, name: variant.product_name, qty: 1, price, cost });
        subtotal += price;
        totalCost += cost;

        // If phone, mark an IMEI as sold
        if (variant.is_serialized) {
          const imei = await queryOne<{ id: string }>(
            `SELECT id FROM imei_units WHERE variant_id = $1 AND lifecycle_status = 'in_stock' LIMIT 1`,
            [variant.id]
          );
          if (imei) {
            await execute(
              `UPDATE imei_units SET lifecycle_status = 'sold', sold_at = $1 WHERE id = $2`,
              [dateStr, imei.id]
            );
            await execute(
              `INSERT INTO stock_movements (id, variant_id, imei_unit_id, movement_type, direction, quantity, unit_cost, reference_type, reference_id, user_id, reason, created_at)
               VALUES ($1, $2, $3, 'sale', 'out', 1, $4, 'sale', $5, $6, 'Vente', $7)`,
              [generateId(), variant.id, imei.id, cost, saleId, sellerId, dateStr]
            );
          }
        } else {
          await execute(
            `INSERT INTO stock_movements (id, variant_id, movement_type, direction, quantity, unit_cost, reference_type, reference_id, user_id, reason, created_at)
             VALUES ($1, $2, 'sale', 'out', 1, $3, 'sale', $4, $5, 'Vente', $6)`,
            [generateId(), variant.id, cost, saleId, sellerId, dateStr]
          );
        }
      }

      const discount = Math.random() > 0.8 ? Math.floor(Math.random() * 2000) + 500 : 0;
      const total = subtotal - discount;

      await execute(
        `INSERT INTO sales (id, ticket_number, store_id, user_id, customer_id, subtotal, discount, tax_amount, total, total_cost, status, sale_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, 'completed', $10)`,
        [saleId, ticketNum, storeId, sellerId, customerId, subtotal, discount, total, totalCost, dateStr]
      );

      for (const line of lines) {
        await execute(
          `INSERT INTO sale_lines (id, sale_id, variant_id, product_name, quantity, unit_price, unit_cost, discount, line_total)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8)`,
          [generateId(), saleId, line.variantId, line.name, line.qty, line.price, line.cost, line.price * line.qty]
        );
      }

      const payMethod = pick(paymentMethods);
      await execute(
        `INSERT INTO sale_payments (id, sale_id, payment_method, amount, reference)
         VALUES ($1, $2, $3, $4, $5)`,
        [generateId(), saleId, payMethod, total, payMethod !== 'cash' ? `TX${Math.floor(Math.random() * 999999)}` : null]
      );

      // Cash session + movement for cash sales
      if (day <= 1 || Math.random() > 0.5) {
        const session = await queryOne<{ id: string }>(
          `SELECT id FROM cash_sessions WHERE user_id = $1 AND status = 'open' AND opened_at <= $2 ORDER BY opened_at DESC LIMIT 1`,
          [sellerId, dateStr]
        );
        if (session) {
          await execute(
            `INSERT INTO cash_movements (id, cash_session_id, movement_type, payment_method, amount, direction, reference_type, reference_id, user_id, reason, created_at)
             VALUES ($1, $2, 'sale', $3, $4, 'in', 'sale', $5, $6, 'Vente', $7)`,
            [generateId(), session.id, payMethod, total, saleId, sellerId, dateStr]
          );
        }
      }

      // Journal entries
      await execute(
        `INSERT INTO journal_entries (id, date, account_debit, account_credit, amount, description, reference_type, reference_id, user_id, created_at)
         VALUES ($1, $2, 'Caisse', 'Ventes', $3, 'Vente ' || $4, 'sale', $5, $6, $7)`,
        [generateId(), dateStr, total, ticketNum, saleId, sellerId, dateStr]
      );
      await execute(
        `INSERT INTO journal_entries (id, date, account_debit, account_credit, amount, description, reference_type, reference_id, user_id, created_at)
         VALUES ($1, $2, 'COGS', 'Stock', $3, 'COGS ' || $4, 'sale', $5, $6, $7)`,
        [generateId(), dateStr, totalCost, ticketNum, saleId, sellerId, dateStr]
      );
    }
  }

  // Cash sessions (one open for today for the first seller)
  const todaySessionId = generateId();
  await execute(
    `INSERT INTO cash_sessions (id, store_id, user_id, register_number, opening_amount, status, opened_at)
     VALUES ($1, $2, $3, 1, 10000, 'open', $4)`,
    [todaySessionId, storeId, sellerIds[0], now()]
  );
  await execute(
    `INSERT INTO cash_movements (id, cash_session_id, movement_type, payment_method, amount, direction, reference_type, user_id, reason, created_at)
     VALUES ($1, $2, 'opening', 'cash', 10000, 'in', 'cash_open', $3, 'Fond de caisse', $4)`,
    [generateId(), todaySessionId, sellerIds[0], now()]
  );

  // Some expenses
  const expenseCategories = ['loyer', 'électricité', 'transport', 'publicité', 'divers'];
  for (let i = 0; i < 10; i++) {
    const cat = pick(expenseCategories);
    const amount = Math.floor(Math.random() * 30000) + 5000;
    await execute(
      `INSERT INTO expenses (id, store_id, user_id, category, amount, payment_method, description, expense_date, created_at)
       VALUES ($1, $2, $3, $4, $5, 'cash', $6, $7, $8)`,
      [generateId(), storeId, users[0].id, cat, amount, `Dépense ${cat}`, randomDate(Math.floor(Math.random() * 30)), now()]
    );
  }

  await markSeeded();
}
