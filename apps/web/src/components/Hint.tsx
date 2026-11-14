import { HelpCircle } from 'lucide-react';

/**
 * علامة استفهام في دائرة: لما تقف عليها (أو توصلها بـ Tab) يظهر شرح الجزء ده أو أرقامه.
 * `side="end"` يفتح الشرح ناحية اليسار (للعناصر اللي على يمين الشاشة)، و"start" العكس.
 */
export function Hint({ text, side = 'end' }: { text: string; side?: 'start' | 'end' }) {
  return (
    <span className={`hint hint-${side}`} tabIndex={0} role="note" aria-label={text} onClick={(e) => e.stopPropagation()}>
      <HelpCircle aria-hidden="true" />
      <span className="hint-pop" aria-hidden="true">{text}</span>
    </span>
  );
}
