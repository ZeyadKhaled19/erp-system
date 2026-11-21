import { WORKSPACE_IDS } from '@erp/shared';
import { z } from 'zod';

export const userSchema = z.object({
  id: z.string().optional(),
  username: z.string().trim().min(2, 'اسم المستخدم حرفان على الأقل').max(50),
  full_name: z.string().trim().min(2).max(100),
  role_id: z.string(),
  active: z.boolean().default(true),
  password: z.string().min(6, 'كلمة المرور 6 أحرف على الأقل').optional(),
  warehouse_ids: z.array(z.string()).nullable().optional(),
  cashbox_ids: z.array(z.string()).nullable().optional(),
  extra_permissions: z.array(z.string()).optional(),
  denied_permissions: z.array(z.string()).optional(),
});

export const roleHomeSchema = z.object({ role_id: z.string().min(1).max(100), workspace: z.enum(WORKSPACE_IDS as [string, ...string[]]).nullable() });

export const roleSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(50),
  permissions: z.array(z.string()),
  limits: z.object({ max_discount_bp: z.number().int().min(0).max(10000).optional(), max_discount_amount: z.number().int().min(0).optional() }).default({}),
});

/** الإعدادات: قائمة مفاتيح مسموحة، وقيمة كل مفتاح بتتفحص في الخدمة (رسائل خاصة بكل إعداد) */
export const settingsSchema = z.record(z.any());

export const SETTINGS_KEYS = [
  'company_name', 'system_name', 'company_address', 'company_phone', 'company_tax_no', 'default_tax_rate_bp', 'allow_negative_stock', 'enforce_credit_limit', 'invoice_footer', 'default_due_days', 'locked_until',
  'print_logo', 'print_template_invoice', 'print_template_voucher', 'print_show_balance', 'print_contract_terms',
  'work_start_time', 'work_end_time', 'late_grace_minutes', 'weekly_off_days', 'monthly_leave_days',
];
