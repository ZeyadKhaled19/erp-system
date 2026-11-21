import { z } from 'zod';

export const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1), device_id: z.string().min(8).max(64), device_name: z.string().max(100).optional(), new_password: z.string().max(200).optional() });
export const changeSchema = z.object({ current: z.string(), next: z.string().min(6, 'كلمة المرور الجديدة 6 أحرف على الأقل') });
