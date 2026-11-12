import { formatMoney } from '@erp/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { CostInfo } from '../lib/costs';

/**
 * خانة عائمة تظهر عند الإشارة بالماوس على عنصر وتختفي عند إبعاده.
 * تُرسم فوق الصفحة (لا يقصها أي صندوق) وتُخفى عند التمرير.
 */
export function useHoverCard() {
  const [st, setSt] = useState<{ content: ReactNode; rect: DOMRect } | null>(null);
  useEffect(() => {
    if (!st) return;
    const hide = () => setSt(null);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, [st]);
  const bind = (content: ReactNode) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => setSt({ content, rect: e.currentTarget.getBoundingClientRect() }),
    onMouseLeave: () => setSt(null),
  });
  let node: ReactNode = null;
  if (st) {
    const { rect } = st;
    const below = window.innerHeight - rect.bottom > 120;
    const center = Math.min(Math.max(rect.left + rect.width / 2, 130), window.innerWidth - 130);
    node = createPortal(
      <div className={`hover-card ${below ? 'below' : 'above'}`} role="tooltip" style={{ left: center, ...(below ? { top: rect.bottom + 8 } : { bottom: window.innerHeight - rect.top + 8 }) }}>
        {st.content}
      </div>,
      document.body,
    );
  }
  return { bind, node, hide: () => setSt(null) };
}

/** محتوى خانة سعر الشراء */
export function CostCard({ c, unit }: { c: CostInfo | undefined; unit?: string }) {
  if (!c || (c.last == null && c.avg == null)) return <div className="hc-empty">لا يوجد سعر شراء مسجل لهذا الصنف</div>;
  return (
    <>
      <div className="hc-title">سعر الشراء{unit ? <span> · لكل {unit}</span> : null}</div>
      {c.last != null && (
        <div className="hc-row">
          <span>آخر سعر شراء</span>
          <b className="num">{formatMoney(c.last)}</b>
        </div>
      )}
      {c.lastDate && <div className="hc-sub num">بتاريخ {c.lastDate}</div>}
      {c.avg != null && (
        <div className="hc-row">
          <span>متوسط التكلفة</span>
          <b className="num">{formatMoney(c.avg)}</b>
        </div>
      )}
    </>
  );
}
