import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Banner } from '../components/ui';
import { useRemote } from '../lib/hooks';

const ACTION: Record<string, string> = {
  'master.upsert': 'حفظ بيانات أساسية',
  'doc.save': 'حفظ مستند',
  'doc.post': 'ترحيل مستند',
  'doc.cancel': 'إلغاء مستند',
  'conflict.resolve': 'حل تعارض',
  login: 'تسجيل دخول',
  login_failed: 'محاولة دخول فاشلة',
  change_password: 'تغيير كلمة المرور',
  'user.save': 'حفظ مستخدم',
  'role.save': 'حفظ دور',
  'settings.save': 'حفظ الإعدادات',
  'backup.create': 'نسخة احتياطية',
  'backup.restore': 'استعادة نسخة',
};

export function AuditPage() {
  const nav = useNavigate();
  const r = useRemote<any>('/api/admin/audit');
  return (
    <div className="page">
      <PageHeader title="سجل التدقيق" sub="آخر 500 عملية: المستخدم والجهاز والوقت وحالة المزامنة" />
      {r.error && <Banner kind="warn">{r.error}</Banner>}
      {r.data && (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>وقت الاستلام</th><th>وقت التسجيل على الجهاز</th><th>المستخدم</th><th>الجهاز</th><th>العملية</th><th>الكيان</th><th>الحالة</th><th>تفاصيل</th></tr></thead>
            <tbody>
              {r.data.rows.map((a: any) => (
                <tr key={a.id} className={a.entity === 'document' ? 'click' : ''} onClick={() => a.entity === 'document' && nav(`/docs/view/${a.entity_id}`)}>
                  <td data-label="الوقت" className="num small">{new Date(a.at).toLocaleString('ar-EG')}</td>
                  <td data-label="على الجهاز" className="num small muted">{a.client_created_at ? new Date(a.client_created_at).toLocaleString('ar-EG') : ''}</td>
                  <td data-label="المستخدم">{a.user_name ?? '—'}</td>
                  <td data-label="الجهاز" className="small">{a.device_name ?? String(a.device_id ?? '').slice(0, 8)}</td>
                  <td data-label="العملية">{ACTION[a.action] ?? a.action}</td>
                  <td data-label="الكيان" className="small muted">{a.entity}</td>
                  <td data-label="الحالة">{a.sync_status && <span className={`badge ${a.sync_status === 'accepted' ? 'green' : a.sync_status === 'rejected' ? 'red' : 'orange'}`}>{a.sync_status === 'accepted' ? 'مقبول' : a.sync_status === 'rejected' ? 'مرفوض' : 'تعارض'}</span>}</td>
                  <td data-label="تفاصيل" className="small muted" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.details?.message ?? a.details?.result?.number ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
