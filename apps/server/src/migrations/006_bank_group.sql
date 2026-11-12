-- نوع عميل «بنك» افتراضي (يُختار تلقائيًا عند الدفع بفيزا أو تحويل أو محفظة)
INSERT INTO party_groups (id, name, kind, sort) VALUES ('pg-bank', 'بنك', 'customer', 4)
  ON CONFLICT DO NOTHING;
