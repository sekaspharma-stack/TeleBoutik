export type UserRole = 'owner' | 'manager' | 'seller' | 'accountant';

export interface User {
  id: string;
  name: string;
  pin: string;
  role: UserRole;
  active: boolean;
  commission_rate: number;
  fixed_salary: number;
  created_at: string;
}

export interface Store {
  id: string;
  name: string;
  address: string;
  phone: string;
  currency: string;
  currency_decimals: number;
  tax_rate: number;
  tax_enabled: boolean;
  max_seller_discount: number;
  max_manager_discount: number;
  credit_limit_default: number;
  return_window_days: number;
  ticket_width: '58' | '80';
  footer_text: string;
}

export interface Product {
  id: string;
  brand: string;
  family: string;
  model: string;
  category: string;
  image_url: string | null;
  is_serialized: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  sku: string;
  barcode: string;
  attributes: Record<string, string>;
  purchase_price: number;
  sale_price: number;
  wholesale_price: number;
  currency_code?: 'USD' | 'CDF' | string;
  min_stock: number;
  max_stock: number;
  created_at: string;
  updated_at: string;
}

export interface ImeiUnit {
  id: string;
  variant_id: string;
  imei1: string;
  imei2: string | null;
  serial_number: string | null;
  lifecycle_status: 'ordered' | 'received' | 'in_stock' | 'sold' | 'returned' | 'repair' | 'traded_in' | 'retired';
  cost: number;
  grade: 'new' | 'A' | 'B' | 'C' | null;
  received_at: string;
  sold_at: string | null;
  notes: string | null;
}

export interface StockMovement {
  id: string;
  variant_id: string;
  imei_unit_id: string | null;
  movement_type: 'purchase' | 'sale' | 'return' | 'adjustment' | 'inventory' | 'transfer' | 'loss' | 'repair';
  direction: 'in' | 'out';
  quantity: number;
  unit_cost: number;
  reference_type: string;
  reference_id: string | null;
  user_id: string;
  reason: string;
  created_at: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  credit_limit: number;
  outstanding_balance: number;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  payment_terms: string;
  balance: number;
  created_at: string;
}

export interface Sale {
  id: string;
  ticket_number: string;
  store_id: string;
  user_id: string;
  customer_id: string | null;
  subtotal: number;
  discount: number;
  tax_amount: number;
  total: number;
  total_cost: number;
  status: 'completed' | 'cancelled' | 'on_credit' | 'pending';
  sale_date: string;
  notes: string | null;
  currency_code?: string;
  exchange_rate?: number;
  exchange_rate_buy?: number;
  change_currency?: string;
  change_amount?: number;
}

export interface SaleLine {
  id: string;
  sale_id: string;
  variant_id: string;
  imei_unit_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  discount: number;
  line_total: number;
}

export interface SalePayment {
  id: string;
  sale_id: string;
  payment_method: 'cash' | 'orange_money' | 'mtn_momo' | 'wave' | 'card' | 'transfer' | 'credit' | 'voucher';
  amount: number;
  reference: string | null;
  currency_code?: string;
  original_amount?: number;
  applied_rate?: number;
}

export interface CashSession {
  id: string;
  store_id: string;
  user_id: string;
  register_number: number;
  opening_amount: number;
  closing_amount: number | null;
  expected_closing: number | null;
  difference: number | null;
  status: 'open' | 'closed';
  opened_at: string;
  closed_at: string | null;
  notes: string | null;
}

export interface CashMovement {
  id: string;
  cash_session_id: string;
  movement_type: 'sale' | 'expense' | 'deposit' | 'withdrawal' | 'adjustment' | 'opening';
  payment_method: 'cash' | 'orange_money' | 'mtn_momo' | 'wave' | 'card' | 'transfer';
  amount: number;
  direction: 'in' | 'out';
  reference_type: string;
  reference_id: string | null;
  user_id: string;
  reason: string;
  created_at: string;
  currency_code?: string;
  original_amount?: number;
  applied_rate?: number;
}

export interface Expense {
  id: string;
  store_id: string;
  user_id: string;
  category: string;
  amount: number;
  payment_method: 'cash' | 'orange_money' | 'mtn_momo' | 'wave' | 'card' | 'transfer';
  description: string;
  receipt_url: string | null;
  expense_date: string;
  created_at: string;
}

export interface JournalEntry {
  id: string;
  date: string;
  account_debit: string;
  account_credit: string;
  amount: number;
  description: string;
  reference_type: string;
  reference_id: string;
  user_id: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  user_role: string;
  entity: string;
  action: string;
  before_data: string | null;
  after_data: string | null;
  sync_op_id: string | null;
  prev_hash: string | null;
  hash: string;
  created_at: string;
}

export interface SyncOp {
  id: string;
  entity: string;
  operation: 'insert' | 'update' | 'delete' | 'cancel';
  record_id: string;
  data: string;
  logical_clock: number;
  status: 'pending' | 'synced' | 'conflict' | 'rejected';
  error_message: string | null;
  created_at: string;
  synced_at: string | null;
}

export interface Settings {
  id: string;
  key: string;
  value: string;
}

export interface CreditPlan {
  id: string;
  sale_id: string;
  customer_id: string;
  total_amount: number;
  initial_payment: number;
  remaining_amount: number;
  installments_count: number;
  installment_amount: number;
  frequency_days: number;
  status: 'active' | 'paid' | 'late';
  created_at: string;
}

export interface CreditInstallment {
  id: string;
  credit_plan_id: string;
  installment_number: number;
  amount: number;
  due_date: string;
  paid_amount: number;
  paid_date: string | null;
  status: 'pending' | 'paid' | 'late';
}

export interface Purchase {
  id: string;
  supplier_id: string;
  store_id: string;
  user_id: string;
  reference: string;
  status: 'draft' | 'ordered' | 'partial' | 'received' | 'cancelled';
  total_amount: number;
  paid_amount: number;
  extra_costs: number;
  order_date: string;
  received_date: string | null;
  notes: string | null;
}

export interface PurchaseLine {
  id: string;
  purchase_id: string;
  variant_id: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost: number;
  line_total: number;
}

export interface InventorySession {
  id: string;
  store_id: string;
  user_id: string;
  category: string;
  status: 'open' | 'validated';
  started_at: string;
  validated_at: string | null;
  notes: string | null;
}

export interface TradeIn {
  id: string;
  customer_id: string | null;
  variant_id: string | null;
  imei1: string;
  imei2: string | null;
  brand: string;
  model: string;
  checklist: Record<string, boolean>;
  photos: string[];
  estimated_cost: number;
  grade: 'A' | 'B' | 'C';
  status: 'evaluated' | 'in_stock' | 'sold' | 'rejected';
  user_id: string;
  created_at: string;
}

export interface AuthState {
  user: User | null;
  cashSession: CashSession | null;
  loginTime: number | null;
}
