/**
 * برنامج الويندوز (Eco System) بيحط window.ecoDesktop جوه شباكه بس.
 * في المتصفح العادي (الأجهزة التانية والموقع) القيمة دي مش موجودة، فكل حاجة هنا بتختفي.
 */
export type UpdateState = 'idle' | 'checking' | 'downloading' | 'ready' | 'none' | 'error' | 'unavailable';

export interface DesktopInfo {
  version: string;
  port: number;
  lan: string[];
  backupDir: string;
  backupCopyDir: string;
  dataDir: string;
  lastBackup: { file: string; at: string } | null;
  update: { state: UpdateState; version: string | null; percent: number };
  packaged: boolean;
}

export type DesktopEvent =
  | { type: 'update'; state: UpdateState; version: string | null; percent: number }
  | { type: 'confirm-close'; id: number; updateVersion: string | null }
  | { type: 'closing'; stage: 'backup'; updateVersion: string | null }
  | {
      type: 'closing-done';
      id: number;
      result: { file: string | null; skipped: boolean; error: string | null };
      backupDir: string;
      copyDir: string;
      updateVersion: string | null;
    };

export interface EcoDesktop {
  info(): Promise<DesktopInfo>;
  backupNow(): Promise<{ file: string | null; skipped: boolean; backupDir: string }>;
  openBackups(): Promise<string>;
  openData(): Promise<string>;
  chooseCopyDir(): Promise<string | null>;
  clearCopyDir(): Promise<boolean>;
  checkUpdates(): Promise<{ state: UpdateState; version: string | null; error?: string }>;
  installUpdate(): Promise<boolean>;
  ready(): void;
  reply(id: number, value: unknown): void;
  ack(id: number): void;
  on(cb: (e: DesktopEvent) => void): () => void;
}

export const getDesktop = (): EcoDesktop | undefined => (typeof window !== 'undefined' ? (window as unknown as { ecoDesktop?: EcoDesktop }).ecoDesktop : undefined);
export const isDesktop = () => !!getDesktop();
