import { EG_GOVERNORATES } from '@erp/shared';
import { z } from 'zod';
import { validMachineId } from '../../license';

const governorate = z.string().refine((g) => (EG_GOVERNORATES as readonly string[]).includes(g), 'اختار المحافظة');
const link = z.string().trim().max(300).refine((v) => !v || /^https?:\/\//i.test(v), 'اللينك لازم يبدأ بـ https://');
const phone = z.string().trim().max(30).refine((v) => !v || /^[0-9+\s-]{8,20}$/.test(v), 'الرقم مش مظبوط');

export const licenseSchemas = {
  activate: z.object({ code: z.string().min(10).max(2000) }),
  register: z.object({
    phone: z.string().trim().min(8).max(20),
    business: z.string().trim().min(2, 'اكتب اسم المحل').max(120),
    governorate,
    /** كلمة سر المدير الجديدة (بدل admin123) */
    admin_password: z.string({ required_error: 'اختار كلمة السر' }).max(200),
    /** اسم مستخدم المدير (لو عايز يغيره من admin) */
    admin_username: z.string({ required_error: 'اكتب اسم المستخدم' }).trim().min(2, 'اسم المستخدم حرفين على الأقل').max(50).regex(/^[^\s]+$/, 'اسم المستخدم من غير مسافات'),
  }),
  reset: z.object({ code: z.string().min(10).max(3000) }),
  resetCode: z.object({
    machine_id: z.string().refine(validMachineId, 'رقم الجهاز مش مظبوط'),
    username: z.string().trim().min(2, 'اسم المستخدم حرفين على الأقل').max(50).regex(/^[^\s]+$/, 'اسم المستخدم من غير مسافات'),
    password: z.string().max(200),
  }),
  trialStart: z.object({
    machine_id: z.string().refine(validMachineId),
    phone: z.string().trim().min(8).max(20),
    business: z.string().trim().max(120).optional().nullable(),
    governorate: z.string().max(40).optional().nullable(),
    local_start: z.string().max(40).optional().nullable(),
  }),
  signup: z.object({
    name: z.string().trim().min(2, 'اكتب اسمك').max(100),
    phone: z.string().trim().regex(/^[0-9+\s-]{8,20}$/, 'رقم الموبايل مش مظبوط'),
    business: z.string().trim().min(2, 'اكتب اسم النشاط أو المحل').max(120),
    activity: z.string().trim().max(80).optional().nullable(),
    governorate,
    city: z.string().trim().max(60).optional().nullable(),
    website: z.string().max(0).optional(), // خانة مخفية: لو اتملت يبقى برنامج آلي
  }),
  ping: z.object({
    machine_id: z.string().refine(validMachineId),
    company_name: z.string().trim().max(120).optional().nullable(),
    version: z.string().trim().max(20).optional().nullable(),
    status: z.enum(['trial', 'active', 'expired']).optional().nullable(),
    days_left: z.number().int().min(0).max(36500).optional().nullable(),
    expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    legacy: z.boolean().optional(),
  }),
  contact: z.object({ phone, whatsapp: phone, facebook: link, youtube: link }),
  signupUpdate: z.object({ status: z.enum(['new', 'contacted', 'activated', 'dropped']).optional(), notes: z.string().max(1000).nullable().optional() }),
  license: z.object({
    machine_id: z.string().refine(validMachineId, 'رقم الجهاز مش مظبوط. المفروض 16 حرف ورقم زي A1B2-C3D4-E5F6-0718'),
    customer: z.string().trim().min(2, 'اكتب اسم العميل').max(120),
    phone: z.string().trim().max(30).optional().nullable(),
    plan: z.enum(['month', 'quarter', 'year', 'life', 'days']),
    days: z.number().int().min(1).max(3650).optional(),
    signup_id: z.string().max(64).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
    /** المبلغ المدفوع بالقرش */
    amount: z.number().int().min(0).max(1e12).optional(),
  }),
};

export type LicenseSchemas = { [K in keyof typeof licenseSchemas]: z.infer<(typeof licenseSchemas)[K]> };
