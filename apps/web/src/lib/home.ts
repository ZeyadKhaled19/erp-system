import { canUseWorkspace, resolveHome, WORKSPACES, type Workspace } from '@erp/shared';
import { useEffect, useMemo, useState } from 'react';
import { useSession, useSettings } from './hooks';

/**
 * صفحة البداية لكل مستخدم. التفضيل يُحفظ محليًا بمفتاح خاص بالمستخدم (لا يختلط بين مستخدمي نفس الجهاز).
 * فتح صفحة البداية لا يمنح أي صلاحية: كل شاشة محمية بحارس الصلاحيات وكل عملية يتحقق منها الخادم.
 */
const prefKey = (uid: string) => `erp.home.${uid}`;
/** يُضبط بعد أول توجيه في الجلسة حتى لا يُعاد التوجيه عند الضغط على «الرئيسية» */
export const LANDED_KEY = 'erp.landed';

export function getHomePref(uid: string): string | null {
  try {
    return localStorage.getItem(prefKey(uid)) || null;
  } catch {
    return null;
  }
}

export function setHomePref(uid: string, id: string | null) {
  try {
    if (id) localStorage.setItem(prefKey(uid), id);
    else localStorage.removeItem(prefKey(uid));
  } catch {
    /* التخزين غير متاح */
  }
  window.dispatchEvent(new CustomEvent('erp:home'));
}

export function clearLanded() {
  try {
    sessionStorage.removeItem(LANDED_KEY);
  } catch {
    /* ignore */
  }
}

export function parseRoleHomes(v: unknown): Record<string, string> {
  if (!v) return {};
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return {};
    }
  }
  return typeof v === 'object' ? (v as Record<string, string>) : {};
}

export function useHome(): {
  home: Workspace;
  roleDefault: Workspace;
  pref: string | null;
  setPref: (id: string | null) => void;
  available: Workspace[];
  settingsReady: boolean;
} {
  const { session } = useSession();
  const settings = useSettings();
  const uid = session.user.id;
  const perms = session.user.permissions;
  const [pref, setPrefState] = useState(() => getHomePref(uid));
  useEffect(() => {
    setPrefState(getHomePref(uid));
    const h = () => setPrefState(getHomePref(uid));
    window.addEventListener('erp:home', h);
    return () => window.removeEventListener('erp:home', h);
  }, [uid]);
  const roleHomes = parseRoleHomes(settings.role_home_pages);
  const roleHomesKey = JSON.stringify(roleHomes);
  return useMemo(() => {
    const roleDefault = resolveHome({ perms, roleId: session.user.role_id, roleHomes });
    return {
      home: resolveHome({ perms, roleId: session.user.role_id, preference: pref, roleHomes }),
      roleDefault,
      pref,
      setPref: (id: string | null) => setHomePref(uid, id),
      available: WORKSPACES.filter((w) => canUseWorkspace(w.id, perms)),
      settingsReady: Object.keys(settings).length > 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pref, roleHomesKey, perms, session.user.role_id, uid, settings]);
}
