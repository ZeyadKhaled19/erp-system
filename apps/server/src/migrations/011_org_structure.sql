-- الهيكل التنظيمي: الإدارات (ولها إدارة أم ومدير)، قائمة الوظائف، وربط كل موظف بإدارة ووظيفة ومدير مباشر

CREATE TABLE departments (
  id text PRIMARY KEY,
  name text NOT NULL,
  -- الإدارة الأم (قسم داخل إدارة) — يُتحقق منها في الخادم (بدون دوائر)
  parent_id text,
  -- مدير الإدارة (موظف)
  manager_id text,
  notes text,
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE job_titles (
  id text PRIMARY KEY,
  name text NOT NULL,
  notes text,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  row_version bigint NOT NULL DEFAULT 0
);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS department_id text REFERENCES departments(id);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS job_title_id text REFERENCES job_titles(id);
-- المدير المباشر («بيتبع مين») — يُتحقق منه في الخادم (بدون دوائر)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS manager_id text;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['departments', 'job_titles']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION bump_row_version()', t || '_rv', t);
    EXECUTE format('CREATE INDEX %I ON %I (row_version)', t || '_rv_idx', t);
  END LOOP;
END
$$;

-- الوظائف المكتوبة نصًا قبل كده تتحول لقائمة الوظائف، ويتربط بيها كل موظف (النص القديم يفضل محفوظ زي ما هو)
INSERT INTO job_titles (id, name)
  SELECT 'jt-' || md5(btrim(job_title)), min(btrim(job_title))
  FROM employees WHERE btrim(coalesce(job_title, '')) <> ''
  GROUP BY md5(btrim(job_title))
  ON CONFLICT DO NOTHING;
UPDATE employees SET job_title_id = 'jt-' || md5(btrim(job_title))
  WHERE btrim(coalesce(job_title, '')) <> '' AND job_title_id IS NULL;
