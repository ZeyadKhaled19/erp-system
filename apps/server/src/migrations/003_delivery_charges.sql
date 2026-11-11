-- التسليم المؤجل/الجزئي لفواتير البيع، ومصروفات وإضافات الفواتير (تحميل المصروفات على التكلفة)

ALTER TABLE documents ADD COLUMN deliver_later boolean NOT NULL DEFAULT false;
ALTER TABLE documents ADD COLUMN order_status text;
ALTER TABLE documents ADD COLUMN shipping_company text;
ALTER TABLE documents ADD COLUMN charges_total bigint NOT NULL DEFAULT 0;
ALTER TABLE document_lines ADD COLUMN delivered_qty bigint NOT NULL DEFAULT 0;

-- كل عملية تسليم (يمكن أن تكون على مراحل) بسطورها وأرقام السيريال وقت التسليم
CREATE TABLE deliveries (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES documents(id),
  date date NOT NULL,
  notes text,
  created_by text REFERENCES users(id),
  device_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  row_version bigint NOT NULL DEFAULT 0
);
CREATE TABLE delivery_lines (
  id bigserial PRIMARY KEY,
  delivery_id text NOT NULL REFERENCES deliveries(id),
  line_id text NOT NULL REFERENCES document_lines(id),
  qty bigint NOT NULL CHECK (qty > 0),
  serials jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX deliveries_doc_idx ON deliveries (document_id);

CREATE TRIGGER deliveries_rv BEFORE INSERT OR UPDATE ON deliveries FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE INDEX deliveries_rv_idx ON deliveries (row_version);

-- حساب نظامي للمصروفات المتنوعة (يُستخدم افتراضيًا لمصروفات فواتير البيع)
UPDATE accounts SET system_key = 'misc_expense' WHERE id = 'acc-5299' AND NOT EXISTS (SELECT 1 FROM accounts WHERE system_key = 'misc_expense');
