-- عمولات المندوبين وإقفال السنة المالية
INSERT INTO accounts (id, code, name, parent_id, type, system_key)
  SELECT 'acc-5208', '5208', 'عمولات المندوبين', 'acc-52', 'expense', 'commissions'
  WHERE EXISTS (SELECT 1 FROM accounts WHERE id = 'acc-52') AND NOT EXISTS (SELECT 1 FROM accounts WHERE system_key = 'commissions')
  ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS documents_rep_idx ON documents (sales_rep_id);
