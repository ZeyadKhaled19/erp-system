import { findSimilarNames, nameKey } from '@erp/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from './db';

type Similar = { id: string; name: string; code?: string | null; active?: boolean };

/**
 * الأصناف الموجودة على الجهاز التي يشبه اسمها الاسم المكتوب (يعمل بدون إنترنت).
 * عند التعديل: الصنف لا يُقارن بنفسه، ولا نحذّر إلا إذا تغيّر الاسم فعلًا
 * حتى لا تتعطل أصناف قديمة مكررة من قبل عند تعديل سعرها مثلًا.
 */
export function useSimilarItems(name: string, current?: { id: string; name: string } | null): Similar[] {
  const items = useLiveQuery(() => db.items.toArray(), []);
  return useMemo(() => {
    if (!items || !nameKey(name)) return [];
    if (current && nameKey(current.name) === nameKey(name)) return [];
    return findSimilarNames(name, items as Similar[], current?.id);
  }, [items, name, current?.id, current?.name]);
}

/** نفس الفحص وقت الضغط على حفظ (من قاعدة الجهاز مباشرة) */
export async function similarItemsNow(name: string, current?: { id: string; name: string } | null): Promise<Similar[]> {
  if (!nameKey(name)) return [];
  if (current && nameKey(current.name) === nameKey(name)) return [];
  return findSimilarNames(name, (await db.items.toArray()) as Similar[], current?.id);
}

/** رسالة تظهر تحت خانة الاسم */
export function similarNameMessage(list: Similar[]): string | null {
  if (!list.length) return null;
  const names = list.map((i) => `«${i.name}»${i.code ? ` (كود ${i.code})` : ''}${i.active === false ? ' — موقوف' : ''}`).join('، ');
  return `${list.length > 1 ? 'يوجد أصناف أسماؤها' : 'يوجد صنف اسمه'} قريب جدًا من هذا الاسم: ${names}. غيّر الاسم حتى يمكن الحفظ، أو استخدم الصنف الموجود.`;
}
