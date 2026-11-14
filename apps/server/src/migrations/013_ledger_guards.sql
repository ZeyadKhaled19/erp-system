-- حماية القيود وحركات المخزن على مستوى قاعدة البيانات نفسها (مش البرنامج بس)
-- 1) سطور القيود وحركات المخزن لا تُعدّل ولا تُحذف بعد تسجيلها؛ التصحيح يكون بقيد/حركة عكسية
-- 2) رأس القيد لا يتغير، إلا ربطه بالقيد العكسي مرة واحدة (reversed_by_id من فاضي لقيمة)
-- 3) كل قيد لازم يكون متوازن (مدين = دائن) عند حفظ المعاملة
-- ملاحظة: الاستعادة من نسخة احتياطية تستخدم TRUNCATE وده ما بيشغّلش الحماية دي

-- فهارس لإلغاء المستندات وعكس قيودها وفحص السلامة بسرعة لما البيانات تكبر
CREATE INDEX IF NOT EXISTS journal_lines_entry_idx ON journal_lines (entry_id);
CREATE INDEX IF NOT EXISTS journal_entries_document_idx ON journal_entries (document_id);
CREATE INDEX IF NOT EXISTS stock_moves_document_idx ON stock_moves (document_id);

CREATE OR REPLACE FUNCTION forbid_ledger_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'لا يمكن تعديل أو حذف سجل مرحّل في %؛ التصحيح يكون بقيد أو حركة عكسية', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_lines_immutable ON journal_lines;
CREATE TRIGGER journal_lines_immutable BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_change();

DROP TRIGGER IF EXISTS stock_moves_immutable ON stock_moves;
CREATE TRIGGER stock_moves_immutable BEFORE UPDATE OR DELETE ON stock_moves
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_change();

CREATE OR REPLACE FUNCTION guard_journal_entry() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'لا يمكن حذف قيد مرحّل؛ التصحيح يكون بقيد عكسي' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.reversed_by_id IS NULL AND NEW.reversed_by_id IS NOT NULL
     AND NEW.id = OLD.id AND NEW.number = OLD.number AND NEW.date = OLD.date
     AND NEW.document_id IS NOT DISTINCT FROM OLD.document_id
     AND NEW.memo IS NOT DISTINCT FROM OLD.memo
     AND NEW.reverses_id IS NOT DISTINCT FROM OLD.reverses_id
     AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
     AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'لا يمكن تعديل قيد مرحّل؛ التصحيح يكون بقيد عكسي' USING ERRCODE = 'integrity_constraint_violation';
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_entries_guard ON journal_entries;
CREATE TRIGGER journal_entries_guard BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION guard_journal_entry();

-- توازن القيد يتفحص في آخر المعاملة (بعد ما كل سطور القيد تتسجل)
CREATE OR REPLACE FUNCTION check_entry_balanced() RETURNS trigger AS $$
DECLARE dr bigint; cr bigint;
BEGIN
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0) INTO dr, cr FROM journal_lines WHERE entry_id = NEW.entry_id;
  IF dr <> cr THEN
    RAISE EXCEPTION 'القيد % غير متوازن: مدين % ودائن %', NEW.entry_id, dr, cr USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_lines_balanced ON journal_lines;
CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_entry_balanced();
