-- الموظف المسؤول عن الخزينة: خزنته تُسمح له تلقائيًا وتظهر أولًا عند البيع والتحصيل
ALTER TABLE cashboxes ADD COLUMN IF NOT EXISTS user_id text REFERENCES users(id);
