-- التجربة المجانية والتراخيص (على موقع صاحب السيستم بس):
-- trial_signups = اللي سجلوا من صفحة «جرّب مجانًا»، licenses = أكواد التفعيل اللي اتطلعت.
-- الجدولين دول مش بيتسحبوا للأجهزة (مش فيهم row_version)، وبيتقروا من صفحة «التراخيص» أونلاين بس.
CREATE TABLE IF NOT EXISTS trial_signups (
  id text PRIMARY KEY,
  name text NOT NULL,
  phone text NOT NULL,
  business text NOT NULL,
  activity text,
  city text,
  notes text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'activated', 'dropped')),
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trial_signups_created_idx ON trial_signups (created_at DESC);

CREATE TABLE IF NOT EXISTS licenses (
  id text PRIMARY KEY,
  machine_id text NOT NULL,
  customer text NOT NULL,
  phone text,
  plan text NOT NULL,
  expires_at date,
  code text NOT NULL,
  signup_id text REFERENCES trial_signups(id),
  notes text,
  created_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS licenses_created_idx ON licenses (created_at DESC);
CREATE INDEX IF NOT EXISTS licenses_machine_idx ON licenses (machine_id);
