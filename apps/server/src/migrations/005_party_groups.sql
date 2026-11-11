-- أنواع العملاء/الموردين (نقدي، آجل، أون لاين، ...) قابلة للإضافة والتعديل
CREATE TABLE IF NOT EXISTS party_groups (
  id text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'customer' CHECK (kind IN ('customer','supplier')),
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  row_version bigint NOT NULL DEFAULT 0,
  UNIQUE (kind, name)
);
CREATE TRIGGER party_groups_rv BEFORE INSERT OR UPDATE ON party_groups FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE INDEX party_groups_rv_idx ON party_groups (row_version);

ALTER TABLE parties ADD COLUMN group_id text REFERENCES party_groups(id);
CREATE INDEX IF NOT EXISTS parties_group_idx ON parties (group_id);

INSERT INTO party_groups (id, name, kind, sort) VALUES
  ('pg-cash', 'نقدي', 'customer', 1),
  ('pg-credit', 'آجل', 'customer', 2),
  ('pg-online', 'أون لاين', 'customer', 3)
  ON CONFLICT DO NOTHING;

-- تصنيف مبدئي للعملاء الحاليين: العميل النقدي ومن لهم حد ائتمان أو رصيد ← آجل
UPDATE parties SET group_id = 'pg-cash' WHERE id = 'party-cash-customer';
UPDATE parties SET group_id = CASE WHEN credit_limit > 0 OR balance <> 0 THEN 'pg-credit' ELSE 'pg-cash' END
  WHERE kind = 'customer' AND group_id IS NULL;
