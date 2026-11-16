-- لوحة صاحب السيستم:
-- المبلغ المدفوع في كل كود تفعيل (بالقرش زي باقي المبالغ)، علشان الدخل يتحسب
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS amount bigint NOT NULL DEFAULT 0;

-- الأجهزة اللي عليها برنامج الويندوز: البرنامج بيبعت حالته لما يكون على النت
-- (رقم الجهاز واسم المحل ورقم النسخة وحالة الترخيص بس، مفيش أي بيانات شغل)
CREATE TABLE IF NOT EXISTS installations (
  machine_id text PRIMARY KEY,
  company_name text,
  version text,
  status text,
  days_left int,
  expires_at date,
  legacy boolean NOT NULL DEFAULT false,
  ip text,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  pings int NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS installations_seen_idx ON installations (last_seen DESC);
