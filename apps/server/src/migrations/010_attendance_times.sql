-- وقت الحضور والانصراف لكل يوم (ساعة:دقيقة بتوقيت الجهاز اللي سجّل)
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_in text CHECK (check_in IS NULL OR check_in ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_out text CHECK (check_out IS NULL OR check_out ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
