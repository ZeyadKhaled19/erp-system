-- وقت آخر تغيير لكلمة السر: أي جلسة (رمز دخول) اتعملت قبله بتتلغي،
-- علشان لو حد عرف كلمة السر ودخل، تغييرها يطلّعه على طول من كل الأجهزة.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;
