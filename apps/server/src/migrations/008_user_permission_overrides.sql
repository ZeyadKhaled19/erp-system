-- صلاحيات خاصة بالمستخدم فوق صلاحيات دوره: إضافة صلاحيات أو منعها لهذا المستخدم وحده
ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_permissions jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS denied_permissions jsonb;
