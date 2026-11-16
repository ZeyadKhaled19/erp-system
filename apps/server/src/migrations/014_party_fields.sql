-- خانات العملاء الحرة: المسئول بيضيف خانات بأي اسم (ماركة، موديل، نوع العربية، المقاس...)
-- كل خانة يا إما قائمة اختيارات يحددها هو (options)، يا إما كلام حر. قيم كل عميل في parties.custom = { id الخانة: id الاختيار أو النص }
CREATE TABLE IF NOT EXISTS party_fields (
  id text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'list' CHECK (kind IN ('list', 'text')),
  applies_to text NOT NULL DEFAULT 'customer' CHECK (applies_to IN ('customer', 'supplier', 'both')),
  options jsonb NOT NULL DEFAULT '[]',
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  row_version bigint NOT NULL DEFAULT 0
);
CREATE TRIGGER party_fields_rv BEFORE INSERT OR UPDATE ON party_fields FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE INDEX party_fields_rv_idx ON party_fields (row_version);

ALTER TABLE parties ADD COLUMN IF NOT EXISTS custom jsonb NOT NULL DEFAULT '{}';

-- ماركات السكوتر القديمة بتتنقل لخانة اسمها «ماركة السكوتر» بنفس الاختيارات ونفس الأرقام،
-- علشان العملاء يفضلوا مربوطين بماركاتهم. (جدول scooter_brands والعمود القديم بيفضلوا للأجهزة القديمة)
INSERT INTO party_fields (id, name, kind, applies_to, options, sort)
SELECT 'pf-scooter-brand', 'ماركة السكوتر', 'list', 'customer',
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'active', b.active) ORDER BY b.sort, b.name) FROM scooter_brands b), '[]'::jsonb), 0
WHERE EXISTS (SELECT 1 FROM scooter_brands) OR EXISTS (SELECT 1 FROM parties WHERE scooter_brand_id IS NOT NULL)
ON CONFLICT (id) DO NOTHING;

UPDATE parties SET custom = custom || jsonb_build_object('pf-scooter-brand', scooter_brand_id)
WHERE scooter_brand_id IS NOT NULL;
