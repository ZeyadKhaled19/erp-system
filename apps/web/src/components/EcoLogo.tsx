/**
 * شعار Eco System: حرف E جوه مربع برتقالي، ودراعاته بتطول من تحت لفوق زي أعمدة مبيعات طالعة.
 * نفس الرسمة في public/icon.svg و public/eco-logo.svg، وملفات التحميل في docs/brand.
 * الألوان ثابتة (برتقالي السيستم + الأسود بتاع الشريط) علشان الشعار يفضل شكله واحد في الوضع الفاتح والغامق.
 */
export function EcoMark({ size = 56, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Eco System">
      <rect width="64" height="64" rx="15" fill="#EA580C" />
      <g fill="#15171C">
        <rect x="12.8" y="12.8" width="9" height="38.4" rx="2" />
        <rect x="12.8" y="12.8" width="38.4" height="9" rx="2" />
        <rect x="12.8" y="27.5" width="31.6" height="9" rx="2" />
        <rect x="12.8" y="42.2" width="25.4" height="9" rx="2" />
      </g>
    </svg>
  );
}

/** الشعار + الاسم */
export function EcoLogo({ size = 44, className, light = false }: { size?: number; className?: string; light?: boolean }) {
  return (
    <span className={`eco-logo-full ${light ? 'light' : ''} ${className ?? ''}`} dir="ltr">
      <EcoMark size={size} />
      <span className="eco-word">
        <b>Eco</b> System
      </span>
    </span>
  );
}

/** رسمة الكفر: كارت مبيعات بأعمدة طالعة وفاتورة مدفوعة (للوحة شاشة الدخول) */
export function EcoCoverArt({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="40 30 350 262" role="img" aria-label="مثال لشاشة مبيعات وفاتورة">
      <rect x="56" y="44" width="260" height="206" rx="12" fill="#1E2128" stroke="#2C3039" />
      <text x="298" y="72" textAnchor="end" fontSize="12" fill="#9CA3AF">مبيعات الشهر</text>
      <text x="298" y="102" textAnchor="end" fontSize="22" fontWeight="700" fill="#F3F4F6">128,450 ج.م</text>
      <rect x="74" y="84" width="54" height="22" rx="11" fill="#3A2416" />
      <text x="101" y="99" textAnchor="middle" fontSize="12" fill="#FB923C">+18%</text>
      <path d="M74 228 H298" stroke="#2C3039" strokeWidth="1" />
      {[[80, 32], [110, 44], [140, 38], [170, 58], [200, 70]].map(([x, h]) => (
        <rect key={x} x={x} y={228 - h} width="20" height={h} rx="4" fill="#3A3F4B" />
      ))}
      <rect className="lg-bar" x="230" y="140" width="20" height="88" rx="4" fill="#C2410C" />
      <rect className="lg-bar" x="260" y="122" width="20" height="106" rx="4" fill="#EA580C" />
      <rect x="232" y="196" width="148" height="88" rx="10" fill="#262A32" stroke="#353A44" />
      <text x="366" y="218" textAnchor="end" fontSize="12" fill="#F3F4F6">فاتورة بيع 1042</text>
      <path d="M246 232 H366" stroke="#3A3F4B" strokeWidth="5" strokeLinecap="round" />
      <path d="M286 246 H366" stroke="#3A3F4B" strokeWidth="5" strokeLinecap="round" />
      <rect x="246" y="258" width="66" height="18" rx="9" fill="#3A2416" />
      <text x="279" y="271" textAnchor="middle" fontSize="11" fill="#FB923C">تم الدفع</text>
      <text x="366" y="272" textAnchor="end" fontSize="13" fontWeight="700" fill="#F3F4F6">2,350</text>
    </svg>
  );
}
