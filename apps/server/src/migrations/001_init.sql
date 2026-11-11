-- البنية الأساسية للنظام
-- كل جدول يُسحب للأجهزة فيه row_version يتغير مع كل كتابة (من تسلسل عام sync_seq)
-- لا نحذف السجلات المرحّلة أبدًا؛ نستخدم الإلغاء بقيد عكسي أو active = false

CREATE SEQUENCE IF NOT EXISTS sync_seq;
CREATE SEQUENCE IF NOT EXISTS journal_no_seq;

CREATE OR REPLACE FUNCTION bump_row_version() RETURNS trigger AS $$
BEGIN
  NEW.row_version := nextval('sync_seq');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE roles (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  permissions jsonb NOT NULL DEFAULT '[]',
  is_system boolean NOT NULL DEFAULT false,
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  full_name text NOT NULL,
  password_hash text NOT NULL,
  role_id text NOT NULL REFERENCES roles(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE devices (
  id text PRIMARY KEY,
  name text,
  user_id text REFERENCES users(id),
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  parent_id text REFERENCES accounts(id),
  type text NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  is_group boolean NOT NULL DEFAULT false,
  system_key text UNIQUE,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE warehouses (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE categories (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE items (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  barcode text UNIQUE,
  category_id text REFERENCES categories(id),
  base_unit text NOT NULL DEFAULT 'قطعة',
  sale_price bigint NOT NULL DEFAULT 0,
  wholesale_price bigint NOT NULL DEFAULT 0,
  last_cost bigint NOT NULL DEFAULT 0,
  avg_cost bigint NOT NULL DEFAULT 0,
  reorder_level bigint NOT NULL DEFAULT 0,
  tax_rate_bp int NOT NULL DEFAULT 0,
  -- محجوزة لتتبع السيريال والصلاحية؛ السياسة النهائية تنتظر تحديد المستخدم
  track_serial boolean NOT NULL DEFAULT false,
  track_expiry boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  notes text,
  version int NOT NULL DEFAULT 1,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version bigint NOT NULL DEFAULT 0
);
CREATE INDEX items_name_idx ON items (name);

CREATE TABLE item_units (
  id text PRIMARY KEY,
  item_id text NOT NULL REFERENCES items(id),
  name text NOT NULL,
  factor bigint NOT NULL CHECK (factor > 0),
  barcode text UNIQUE,
  sale_price bigint NOT NULL DEFAULT 0,
  wholesale_price bigint NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  row_version bigint NOT NULL DEFAULT 0,
  UNIQUE (item_id, name)
);

CREATE TABLE stock_balances (
  item_id text NOT NULL REFERENCES items(id),
  warehouse_id text NOT NULL REFERENCES warehouses(id),
  qty bigint NOT NULL DEFAULT 0,
  value bigint NOT NULL DEFAULT 0,
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, warehouse_id)
);

CREATE TABLE parties (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('customer','supplier')),
  code text NOT NULL,
  name text NOT NULL,
  phone text,
  address text,
  tax_no text,
  credit_limit bigint NOT NULL DEFAULT 0,
  price_list text NOT NULL DEFAULT 'retail',
  -- للعميل: موجب = مدين لنا ؛ للمورد: موجب = دائن (مستحق له)
  balance bigint NOT NULL DEFAULT 0,
  notes text,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  row_version bigint NOT NULL DEFAULT 0,
  UNIQUE (kind, code)
);
CREATE INDEX parties_name_idx ON parties (name);

CREATE TABLE cashboxes (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('cash','bank')),
  account_id text NOT NULL UNIQUE REFERENCES accounts(id),
  balance bigint NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE doc_sequences (
  key text PRIMARY KEY,
  next_no bigint NOT NULL DEFAULT 1
);

CREATE TABLE documents (
  id text PRIMARY KEY,
  doc_type text NOT NULL,
  number text UNIQUE,
  local_number text,
  status text NOT NULL CHECK (status IN ('draft','posted','cancelled','pending_review')),
  date date NOT NULL,
  party_id text REFERENCES parties(id),
  warehouse_id text REFERENCES warehouses(id),
  to_warehouse_id text REFERENCES warehouses(id),
  cashbox_id text REFERENCES cashboxes(id),
  account_id text REFERENCES accounts(id),
  payment_type text,
  side text,
  ref_doc_id text REFERENCES documents(id),
  gross bigint NOT NULL DEFAULT 0,
  discount bigint NOT NULL DEFAULT 0,
  tax bigint NOT NULL DEFAULT 0,
  total bigint NOT NULL DEFAULT 0,
  paid bigint NOT NULL DEFAULT 0,
  cost bigint NOT NULL DEFAULT 0,
  notes text,
  data jsonb NOT NULL DEFAULT '{}',
  review_reason text,
  cancel_reason text,
  created_by text REFERENCES users(id),
  device_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_by text REFERENCES users(id),
  posted_at timestamptz,
  cancelled_by text REFERENCES users(id),
  cancelled_at timestamptz,
  version int NOT NULL DEFAULT 1,
  row_version bigint NOT NULL DEFAULT 0
);
CREATE INDEX documents_type_date_idx ON documents (doc_type, date);
CREATE INDEX documents_party_idx ON documents (party_id);

CREATE TABLE document_lines (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES documents(id),
  line_no int NOT NULL,
  item_id text NOT NULL REFERENCES items(id),
  unit_name text NOT NULL,
  unit_factor bigint NOT NULL,
  qty bigint NOT NULL,
  base_qty bigint NOT NULL,
  price bigint NOT NULL DEFAULT 0,
  discount bigint NOT NULL DEFAULT 0,
  doc_discount bigint NOT NULL DEFAULT 0,
  tax_rate_bp int NOT NULL DEFAULT 0,
  tax bigint NOT NULL DEFAULT 0,
  total bigint NOT NULL DEFAULT 0,
  cost bigint NOT NULL DEFAULT 0,
  system_qty bigint,
  ref_line_id text,
  notes text,
  row_version bigint NOT NULL DEFAULT 0
);
CREATE INDEX document_lines_doc_idx ON document_lines (document_id);

CREATE TABLE stock_moves (
  id bigserial PRIMARY KEY,
  date date NOT NULL,
  item_id text NOT NULL REFERENCES items(id),
  warehouse_id text NOT NULL REFERENCES warehouses(id),
  qty bigint NOT NULL,
  value bigint NOT NULL,
  balance_qty bigint NOT NULL,
  document_id text NOT NULL REFERENCES documents(id),
  line_id text,
  reversal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_moves_item_idx ON stock_moves (item_id, date);
CREATE INDEX stock_moves_wh_idx ON stock_moves (warehouse_id, date);

CREATE TABLE journal_entries (
  id text PRIMARY KEY,
  number bigint NOT NULL UNIQUE DEFAULT nextval('journal_no_seq'),
  date date NOT NULL,
  document_id text REFERENCES documents(id),
  memo text,
  reverses_id text REFERENCES journal_entries(id),
  reversed_by_id text REFERENCES journal_entries(id),
  created_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journal_entries_date_idx ON journal_entries (date);

CREATE TABLE journal_lines (
  id bigserial PRIMARY KEY,
  entry_id text NOT NULL REFERENCES journal_entries(id),
  account_id text NOT NULL REFERENCES accounts(id),
  party_id text REFERENCES parties(id),
  debit bigint NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit bigint NOT NULL DEFAULT 0 CHECK (credit >= 0),
  memo text
);
CREATE INDEX journal_lines_account_idx ON journal_lines (account_id);
CREATE INDEX journal_lines_party_idx ON journal_lines (party_id);

CREATE TABLE processed_ops (
  op_id text PRIMARY KEY,
  device_id text,
  user_id text,
  op_type text NOT NULL,
  seq bigint,
  status text NOT NULL,
  message text,
  result jsonb,
  client_created_at text,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sync_conflicts (
  id text PRIMARY KEY,
  op_id text,
  kind text NOT NULL,
  entity text NOT NULL,
  entity_id text NOT NULL,
  message text NOT NULL,
  server_data jsonb,
  client_data jsonb,
  status text NOT NULL DEFAULT 'open',
  resolution text,
  resolution_note text,
  resolved_by text REFERENCES users(id),
  resolved_at timestamptz,
  created_by text,
  device_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  user_id text,
  device_id text,
  op_id text,
  action text NOT NULL,
  entity text,
  entity_id text,
  sync_status text,
  client_created_at text,
  details jsonb
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['settings','roles','users','accounts','warehouses','categories','items','item_units',
    'stock_balances','parties','cashboxes','documents','document_lines','sync_conflicts']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION bump_row_version()', t || '_rv', t);
    EXECUTE format('CREATE INDEX %I ON %I (row_version)', t || '_rv_idx', t);
  END LOOP;
END
$$;
