import type { LineBrandOption } from '../../lineBrand';

export default function LineBrandSelector({ options, value, accessCode, onChange, onAccessCodeChange }: {
  options: LineBrandOption[]; value: string; accessCode: string;
  onChange: (value: string) => void; onAccessCodeChange: (value: string) => void;
}) {
  const selected = options.find(b => b.id === value);
  return <section className="space-y-2 rounded-xl border border-emerald-700 p-3" aria-label="場次 LINE 品牌">
    <label className="block font-bold" htmlFor="line-brand-select">本場次 LINE 官方帳號</label>
    <select id="line-brand-select" className="w-full rounded-lg bg-gray-800 p-3 text-white" value={value}
      onChange={e => { onChange(e.target.value); onAccessCodeChange(''); }}>
      {options.map(b => <option key={b.id} value={b.id} disabled={b.status !== 'ready'}>
        {b.name}（{b.officialAccountId}）{b.status === 'pending' ? ' — 待完成登入設定' : ''}
      </option>)}
    </select>
    {selected?.requiresAccessCode && selected.status === 'ready' && <>
      <label className="block font-bold" htmlFor="line-brand-access">品牌開場授權碼</label>
      <input id="line-brand-access" type="password" autoComplete="off" value={accessCode}
        className="w-full rounded-lg bg-gray-800 p-3 text-white" onChange={e => onAccessCodeChange(e.target.value)} />
    </>}
    <p className="text-sm text-gray-400">僅用於建立新場次；建立後固定品牌。合作品牌須由平台管理者啟用並提供開場授權碼，與房間主持人控制碼不同。</p>
    {options.some(b => b.status === 'pending') && <p className="text-sm text-amber-200">待設定帳號不能選用：尚缺對應的 LINE Login Channel／LIFF 與連結確認。</p>}
  </section>;
}
