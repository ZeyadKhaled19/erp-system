-- المحافظة في تسجيل التجربة
ALTER TABLE trial_signups ADD COLUMN IF NOT EXISTS governorate text;

-- تجربة واحدة لكل رقم موبايل (على موقع صاحب السيستم):
-- برنامج الويندوز أول ما يتفتح بيسجل رقم موبايل العميل هنا. لو نفس الرقم سجل قبل كده من جهاز تاني،
-- الجهاز الجديد بيكمّل من تاريخ أول تجربة (ولو خلصت يبقى مقفول).
CREATE TABLE IF NOT EXISTS trial_devices (
  machine_id text PRIMARY KEY,
  phone text NOT NULL,
  business text,
  governorate text,
  trial_start timestamptz NOT NULL,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trial_devices_phone_idx ON trial_devices (phone);
