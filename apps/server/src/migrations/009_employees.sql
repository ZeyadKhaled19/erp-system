-- قسم الموظفين: بيانات الموظفين، الحضور اليومي، السلف، ومسيرات الرواتب

-- حساب رئيسي لسلف الموظفين (لكل موظف حساب فرعي تحته) وحساب الرواتب النظامي
INSERT INTO accounts (id, code, name, parent_id, type, is_group, system_key)
  SELECT 'acc-1108', '1108', 'سلف الموظفين', 'acc-11', 'asset', true, 'employee_advances_group'
  WHERE EXISTS (SELECT 1 FROM accounts WHERE id = 'acc-11')
    AND NOT EXISTS (SELECT 1 FROM accounts WHERE system_key = 'employee_advances_group')
  ON CONFLICT DO NOTHING;
UPDATE accounts SET system_key = 'salaries'
  WHERE id = 'acc-5202' AND system_key IS NULL AND type = 'expense' AND NOT is_group
    AND NOT EXISTS (SELECT 1 FROM accounts WHERE system_key = 'salaries');
INSERT INTO accounts (id, code, name, parent_id, type, system_key)
  SELECT 'acc-5209', '5209', 'رواتب وأجور الموظفين', 'acc-52', 'expense', 'salaries'
  WHERE EXISTS (SELECT 1 FROM accounts WHERE id = 'acc-52')
    AND NOT EXISTS (SELECT 1 FROM accounts WHERE system_key = 'salaries')
  ON CONFLICT DO NOTHING;

CREATE TABLE employees (
  id text PRIMARY KEY,
  code text,
  name text NOT NULL,
  job_title text,
  phone text,
  national_id text,
  hire_date date,
  salary bigint NOT NULL DEFAULT 0 CHECK (salary >= 0),
  advance_account_id text NOT NULL UNIQUE REFERENCES accounts(id),
  -- رصيد السلف المستحق على الموظف (يتحدث مع كل قيد على حساب سلفه)
  advance_balance bigint NOT NULL DEFAULT 0,
  user_id text REFERENCES users(id),
  notes text,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE attendance (
  id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employees(id),
  date date NOT NULL,
  status text NOT NULL CHECK (status IN ('present', 'absent', 'late', 'leave')),
  notes text,
  version int NOT NULL DEFAULT 1,
  row_version bigint NOT NULL DEFAULT 0,
  UNIQUE (employee_id, date)
);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS employee_id text REFERENCES employees(id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employees', 'attendance']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION bump_row_version()', t || '_rv', t);
    EXECUTE format('CREATE INDEX %I ON %I (row_version)', t || '_rv_idx', t);
  END LOOP;
END
$$;
