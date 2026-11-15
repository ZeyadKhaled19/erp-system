// الجسر بين واجهة السيستم وبرنامج الويندوز: الواجهة بتشوف window.ecoDesktop بس جوه البرنامج
// (الأجهزة التانية اللي بتفتح من المتصفح ما عندهاش الكلام ده). بيدّي أوامر محددة بس، مش وصول كامل للجهاز.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ecoDesktop', {
  /** رقم النسخة وحالة التحديث وفولدرات النسخ وعناوين الشبكة */
  info: () => ipcRenderer.invoke('eco:info'),
  /** نسخة احتياطية فورية */
  backupNow: () => ipcRenderer.invoke('eco:backup'),
  openBackups: () => ipcRenderer.invoke('eco:open-backups'),
  openData: () => ipcRenderer.invoke('eco:open-data'),
  /** اختيار فولدر نسخة تانية (فلاشة / هارد / Google Drive) */
  chooseCopyDir: () => ipcRenderer.invoke('eco:choose-copy'),
  clearCopyDir: () => ipcRenderer.invoke('eco:clear-copy'),
  checkUpdates: () => ipcRenderer.invoke('eco:check-updates'),
  /** نسخة احتياطية ← تسطيب التحديث ← البرنامج يفتح تاني */
  installUpdate: () => ipcRenderer.invoke('eco:install-update'),
  /** الواجهة جاهزة تستقبل الرسائل (بدل رسايل ويندوز) */
  ready: () => ipcRenderer.send('eco:ready'),
  /** رد على سؤال من البرنامج (مثلًا تأكيد القفل) */
  reply: (id, value) => ipcRenderer.send('eco:reply', { id, value }),
  /** «الرسالة ظهرت» — علشان البرنامج ما يطلعش رسالة ويندوز بدالها */
  ack: (id) => ipcRenderer.send('eco:ack', { id }),
  /** رسائل من البرنامج: تحديث، سؤال قفل، حالة القفل والنسخة */
  on: (cb) => {
    const h = (_e, m) => cb(m);
    ipcRenderer.on('eco:event', h);
    return () => ipcRenderer.removeListener('eco:event', h);
  },
});
