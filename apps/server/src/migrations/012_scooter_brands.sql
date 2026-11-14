-- ماركات السكوتر: قائمة يحددها صاحب النظام، والموظفين بيختاروا منها في بيانات العميل (لتقرير حسب الماركة)
CREATE TABLE IF NOT EXISTS scooter_brands (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  row_version bigint NOT NULL DEFAULT 0
);
CREATE TRIGGER scooter_brands_rv BEFORE INSERT OR UPDATE ON scooter_brands FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE INDEX scooter_brands_rv_idx ON scooter_brands (row_version);

ALTER TABLE parties ADD COLUMN IF NOT EXISTS scooter_brand_id text REFERENCES scooter_brands(id);
CREATE INDEX IF NOT EXISTS parties_scooter_brand_idx ON parties (scooter_brand_id);
