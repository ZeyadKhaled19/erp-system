export type InvoiceDesign = 'modern' | 'minimal' | 'classic';
export type PrintPreferences = {
  template: string;
  design: InvoiceDesign;
  fontSize: number;
  showLogo: boolean;
  showCodes: boolean;
  showNotes: boolean;
  showSignatures: boolean;
  showBalance: boolean;
  smartColumns: boolean;
};

export const PRINT_DEFAULTS: PrintPreferences = {
  template: '', design: 'modern', fontSize: 11, showLogo: true, showCodes: false,
  showNotes: true, showSignatures: true, showBalance: false, smartColumns: true,
};

export const printPreferencesKey = (userId: string, docType: string) => `erp.print.preferences.${userId}.${docType}`;

export function readPrintPreferences(userId: string, docType: string, showBalance: boolean): PrintPreferences {
  const defaults = { ...PRINT_DEFAULTS, showBalance };
  try {
    const value = JSON.parse(localStorage.getItem(printPreferencesKey(userId, docType)) ?? 'null');
    if (!value || typeof value !== 'object') return defaults;
    const result = { ...defaults };
    if (typeof value.template === 'string') result.template = value.template;
    if (['modern', 'minimal', 'classic'].includes(value.design)) result.design = value.design;
    if ([10, 11, 12, 13].includes(value.fontSize)) result.fontSize = value.fontSize;
    for (const key of ['showLogo', 'showCodes', 'showNotes', 'showSignatures', 'showBalance', 'smartColumns'] as const) {
      if (typeof value[key] === 'boolean') result[key] = value[key];
    }
    return result;
  } catch { return defaults; }
}
