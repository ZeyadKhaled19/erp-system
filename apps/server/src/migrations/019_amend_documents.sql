-- تعديل الفاتورة المرحّلة (doc.amend): إضافة عمودين لربط المستند الأصلي بالمستند المعدّل والعكس
ALTER TABLE documents ADD COLUMN IF NOT EXISTS amended_from_id text REFERENCES documents(id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS amended_to_id text REFERENCES documents(id);
CREATE INDEX IF NOT EXISTS documents_amended_from_idx ON documents (amended_from_id);
CREATE INDEX IF NOT EXISTS documents_amended_to_idx ON documents (amended_to_id);