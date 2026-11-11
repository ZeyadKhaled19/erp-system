-- المرحلة الثانية: السداد المتعدد، الشيكات والأقساط، التخصيص، قوائم الأسعار، المندوبون،
-- عروض الأسعار والحجز، الشركاء، السيريال، دفعات الصلاحية، ورديات الكاشير

-- ---------- المستندات
ALTER TABLE documents ADD COLUMN due_date date;
ALTER TABLE documents ADD COLUMN closed boolean NOT NULL DEFAULT false;
ALTER TABLE documents ADD COLUMN to_cashbox_id text REFERENCES cashboxes(id);
ALTER TABLE documents ADD COLUMN sales_rep_id text;
ALTER TABLE documents ADD COLUMN price_list_id text;
ALTER TABLE documents ADD COLUMN partner_id text;
ALTER TABLE documents ADD COLUMN shift_id text;
ALTER TABLE documents ADD COLUMN reserve boolean NOT NULL DEFAULT false;
ALTER TABLE documents ADD COLUMN converted_to_id text REFERENCES documents(id);
ALTER TABLE documents ADD COLUMN allocated bigint NOT NULL DEFAULT 0;
ALTER TABLE document_lines ADD COLUMN serials jsonb NOT NULL DEFAULT '[]';
ALTER TABLE document_lines ADD COLUMN expiry date;

-- توزيع السداد على أكثر من خزينة (مع عمولة الطريقة)
CREATE TABLE document_payments (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES documents(id),
  cashbox_id text NOT NULL REFERENCES cashboxes(id),
  amount bigint NOT NULL CHECK (amount > 0),
  fee bigint NOT NULL DEFAULT 0,
  row_version bigint NOT NULL DEFAULT 0
);
CREATE INDEX document_payments_doc_idx ON document_payments (document_id);

-- الشيكات والأقساط (واردة من العملاء / صادرة للموردين)
CREATE TABLE instruments (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('cheque','installment')),
  direction text NOT NULL CHECK (direction IN ('in','out')),
  document_id text REFERENCES documents(id),
  party_id text NOT NULL REFERENCES parties(id),
  amount bigint NOT NULL CHECK (amount > 0),
  due_date date NOT NULL,
  cheque_no text,
  bank text,
  notes text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','collected','bounced','closed','cancelled')),
  settled_doc_id text REFERENCES documents(id),
  settled_at timestamptz,
  settled_by text,
  row_version bigint NOT NULL DEFAULT 0
);
CREATE INDEX instruments_party_idx ON instruments (party_id, status);

-- تخصيص المقبوضات/المدفوعات على الفواتير (يدوي بالربط أو تلقائي FIFO)
CREATE TABLE allocations (
  id bigserial PRIMARY KEY,
  source_id text NOT NULL REFERENCES documents(id),
  invoice_id text NOT NULL REFERENCES documents(id),
  amount bigint NOT NULL,
  reversed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX allocations_source_idx ON allocations (source_id);
CREATE INDEX allocations_invoice_idx ON allocations (invoice_id);

-- ---------- الخزائن: عمولة طريقة السداد (بطاقات/محافظ)
ALTER TABLE cashboxes ADD COLUMN fee_bp int NOT NULL DEFAULT 0;
ALTER TABLE cashboxes ADD COLUMN fee_min bigint NOT NULL DEFAULT 0;
ALTER TABLE cashboxes ADD COLUMN fee_fixed bigint NOT NULL DEFAULT 0;

-- ---------- الأصناف
ALTER TABLE items ADD COLUMN min_price bigint NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN is_service boolean NOT NULL DEFAULT false;
ALTER TABLE items ADD COLUMN expiry_default_days int NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN expiry_alert_days int NOT NULL DEFAULT 30;

-- قوائم الأسعار (4 قوائم افتراضيًا) وسعر لكل صنف/وحدة/قائمة
CREATE TABLE price_lists (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  row_version bigint NOT NULL DEFAULT 0
);
CREATE TABLE item_prices (
  id text PRIMARY KEY,
  item_id text NOT NULL REFERENCES items(id),
  unit_name text NOT NULL,
  price_list_id text NOT NULL REFERENCES price_lists(id),
  price bigint NOT NULL CHECK (price >= 0),
  row_version bigint NOT NULL DEFAULT 0,
  UNIQUE (item_id, unit_name, price_list_id)
);

-- ---------- الأطراف
ALTER TABLE parties ADD COLUMN price_list_id text REFERENCES price_lists(id);
ALTER TABLE parties ADD COLUMN discount_bp int NOT NULL DEFAULT 0;
ALTER TABLE parties ADD COLUMN review_date date;
ALTER TABLE parties ADD COLUMN due_days int NOT NULL DEFAULT 0;

CREATE TABLE sales_reps (
  id text PRIMARY KEY,
  name text NOT NULL,
  phone text,
  commission_bp int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  row_version bigint NOT NULL DEFAULT 0
);

-- ---------- المستخدمون: حدود الخصم والمخازن والخزائن المسموحة
ALTER TABLE roles ADD COLUMN limits jsonb NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN warehouse_ids jsonb;
ALTER TABLE users ADD COLUMN cashbox_ids jsonb;

-- ---------- الشركاء
CREATE TABLE partners (
  id text PRIMARY KEY,
  name text NOT NULL,
  phone text,
  ownership_bp int NOT NULL DEFAULT 0 CHECK (ownership_bp BETWEEN 0 AND 10000),
  profit_bp int NOT NULL DEFAULT 0 CHECK (profit_bp BETWEEN 0 AND 10000),
  capital_account_id text NOT NULL UNIQUE REFERENCES accounts(id),
  current_account_id text NOT NULL UNIQUE REFERENCES accounts(id),
  notes text,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  row_version bigint NOT NULL DEFAULT 0
);

-- ---------- السيريال (تتبع صارم للأصناف المفعّل عليها track_serial)
CREATE TABLE serials (
  id text PRIMARY KEY,
  item_id text NOT NULL REFERENCES items(id),
  serial text NOT NULL,
  warehouse_id text REFERENCES warehouses(id),
  status text NOT NULL CHECK (status IN ('in_stock','sold','returned_to_supplier')),
  in_doc_id text REFERENCES documents(id),
  out_doc_id text REFERENCES documents(id),
  row_version bigint NOT NULL DEFAULT 0,
  UNIQUE (item_id, serial)
);
CREATE INDEX serials_serial_idx ON serials (serial);
CREATE TABLE serial_moves (
  id bigserial PRIMARY KEY,
  serial_id text NOT NULL REFERENCES serials(id),
  document_id text NOT NULL REFERENCES documents(id),
  line_id text,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  warehouse_id text,
  reversal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- دفعات الصلاحية (لكل صنف/مخزن/تاريخ انتهاء) — الصرف بالأقرب انتهاءً (FEFO)
CREATE TABLE stock_lots (
  id text PRIMARY KEY,
  item_id text NOT NULL REFERENCES items(id),
  warehouse_id text NOT NULL REFERENCES warehouses(id),
  expiry date NOT NULL,
  qty bigint NOT NULL DEFAULT 0,
  row_version bigint NOT NULL DEFAULT 0,
  UNIQUE (item_id, warehouse_id, expiry)
);
CREATE TABLE lot_moves (
  id bigserial PRIMARY KEY,
  lot_id text NOT NULL REFERENCES stock_lots(id),
  document_id text NOT NULL REFERENCES documents(id),
  line_id text,
  qty bigint NOT NULL,
  reversal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- ورديات الكاشير
CREATE TABLE cashier_shifts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  cashbox_id text NOT NULL REFERENCES cashboxes(id),
  device_id text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_float bigint NOT NULL DEFAULT 0,
  closed_at timestamptz,
  expected_cash bigint,
  counted_cash bigint,
  difference bigint,
  close_doc_id text REFERENCES documents(id),
  notes text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  row_version bigint NOT NULL DEFAULT 0
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['document_payments','instruments','price_lists','item_prices','sales_reps','partners','serials','stock_lots','cashier_shifts']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION bump_row_version()', t || '_rv', t);
    EXECUTE format('CREATE INDEX %I ON %I (row_version)', t || '_rv_idx', t);
  END LOOP;
END
$$;

-- ---------- بيانات افتراضية للمرحلة الثانية
INSERT INTO price_lists (id, name, sort) VALUES
  ('pl-retail', 'قطاعي', 1), ('pl-wholesale', 'جملة', 2), ('pl-3', 'سعر 3', 3), ('pl-4', 'سعر 4', 4)
  ON CONFLICT DO NOTHING;
UPDATE parties SET price_list_id = CASE WHEN price_list = 'wholesale' THEN 'pl-wholesale' ELSE 'pl-retail' END;
INSERT INTO item_prices (id, item_id, unit_name, price_list_id, price)
  SELECT 'ip-' || id || '-w', id, base_unit, 'pl-wholesale', wholesale_price FROM items WHERE wholesale_price > 0
  ON CONFLICT DO NOTHING;

-- حسابات نظامية جديدة (تُضاف فقط إذا كان الدليل الافتراضي موجودًا)
UPDATE accounts SET system_key = 'notes_receivable', name = 'أوراق القبض (شيكات تحت التحصيل)' WHERE id = 'acc-1106' AND NOT EXISTS (SELECT 1 FROM accounts WHERE system_key = 'notes_receivable');
UPDATE accounts SET system_key = 'notes_payable', name = 'أوراق الدفع (شيكات صادرة)' WHERE id = 'acc-2103' AND NOT EXISTS (SELECT 1 FROM accounts WHERE system_key = 'notes_payable');
INSERT INTO accounts (id, code, name, parent_id, type, system_key)
  SELECT 'acc-5207', '5207', 'عمولات بنكية وعمولات الدفع', 'acc-52', 'expense', 'payment_fees' WHERE EXISTS (SELECT 1 FROM accounts WHERE id = 'acc-52')
  ON CONFLICT DO NOTHING;
INSERT INTO accounts (id, code, name, parent_id, type, system_key)
  SELECT 'acc-55', '55', 'عجز وزيادة الخزينة', 'acc-5', 'expense', 'cash_over_short' WHERE EXISTS (SELECT 1 FROM accounts WHERE id = 'acc-5')
  ON CONFLICT DO NOTHING;
-- رأس المال وجاري الشركاء يصبحان حسابين رئيسيين لحسابات كل شريك
INSERT INTO accounts (id, code, name, parent_id, type, is_group, system_key)
  SELECT 'acc-34', '34', 'رؤوس أموال الشركاء', 'acc-3', 'equity', true, 'partners_capital_group' WHERE EXISTS (SELECT 1 FROM accounts WHERE id = 'acc-3')
  ON CONFLICT DO NOTHING;
INSERT INTO accounts (id, code, name, parent_id, type, is_group, system_key)
  SELECT 'acc-2106', '2106', 'حسابات الشركاء الجارية', 'acc-21', 'liability', true, 'partners_current_group' WHERE EXISTS (SELECT 1 FROM accounts WHERE id = 'acc-21')
  ON CONFLICT DO NOTHING;
INSERT INTO accounts (id, code, name, parent_id, type, system_key)
  SELECT 'acc-35', '35', 'توزيعات أرباح معلنة', 'acc-3', 'equity', 'profit_distribution' WHERE EXISTS (SELECT 1 FROM accounts WHERE id = 'acc-3')
  ON CONFLICT DO NOTHING;

INSERT INTO settings (key, value) VALUES ('locked_until', 'null'), ('default_due_days', '0') ON CONFLICT DO NOTHING;
