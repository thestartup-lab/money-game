import { useState } from 'react';
import type { GameState, Player, CareerOption } from '../../types/game';
import EffectPreview from './EffectPreview';

const fmt = (n: number) => Math.round(n).toLocaleString();
const QUADRANT_LABEL: Record<string, string> = { E: 'E 受薪族', S: 'S 自僱者', B: 'B 企業主', I: 'I 投資者' };

function salaryText(o: CareerOption): string {
  if (o.salaryType === 'random' && o.salaryRange) return `$${fmt(o.salaryRange[0])}–$${fmt(o.salaryRange[1])}（每月隨機）`;
  if (o.salaryType === 'nt_driven') return `底薪 $${fmt(o.salaryBase ?? 0)} + 人脈 × $${fmt(o.salaryPerNT ?? 0)}`;
  if (o.salaryType === 'sk_driven') return `$${fmt(o.salary ?? 0)} + 專長 × $${fmt(o.salaryPerSK ?? 0)}（轉職後 SK 從 0 起）`;
  return `$${fmt(o.salary ?? 0)}`;
}

export default function CareerStagePanel({ gameState, player, emit }: {
  gameState: GameState; player: Player; emit: (event: string, payload: unknown) => void;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'E' | 'S' | 'B' | 'I'>('all');
  const scene = gameState.facilitatorScene;
  const request = gameState.careerRequests?.find(r => r.playerId === player.id);
  const button = 'min-h-14 w-full rounded-xl border-2 border-yellow-400 bg-yellow-900 p-3 text-lg font-black text-white disabled:opacity-40';

  if (scene?.kind === 'career' && scene.careerPlayerId === player.id) {
    return <section className="mx-4 mb-3 space-y-3 rounded-2xl border-2 border-yellow-400 bg-slate-900 p-5" aria-label="本人轉職確認">
      <h3 className="text-2xl font-black text-yellow-200">你的職涯選擇</h3>
      <p className="whitespace-pre-line text-lg leading-relaxed text-white">{scene.stage === 'result' ? scene.resultDescription : scene.description}</p>
      {scene.stage === 'prompt' ? <>
        {scene.careerConfirmed ? <p className="text-xl font-bold text-emerald-200">已確認，請看大螢幕，等待主持人揭曉。</p> :
          <button className={button} onClick={() => emit('confirmCareerScene', { sceneId: scene.id, accepted: true })}>我已了解代價，確認轉職</button>}
        <button className={button} onClick={() => emit('confirmCareerScene', { sceneId: scene.id, accepted: false })}>取消本次轉職，保留原職業</button>
      </> : <p className="text-xl font-bold text-emerald-200">請等主持人繼續遊戲。</p>}
    </section>;
  }

  if (request) {
    const position = player.careerQueuePosition ?? 1;
    return <section className="mx-4 mb-3 rounded-2xl border-2 border-yellow-400 bg-slate-900 p-5 text-lg text-white" aria-live="polite">
      <p className="font-black">🎯 已申請轉職：{request.professionName}</p>
      <p className="my-2 text-base text-gray-200">{position > 1 ? `排在第 ${position} 位，` : ''}等主持人在大螢幕開啟「轉職舞台」，你再確認代價；目前沒有扣款，職業也還沒變。</p>
      <p className="mb-3 text-sm text-yellow-200">提醒主持人：後台「🎯 等待轉職」區按「開啟轉職舞台」（要等目前回合、決策與發薪結束）。</p>
      <button className={button} onClick={() => emit('cancelCareerRequest', { requestId: request.id })}>撤回申請</button>
    </section>;
  }

  if (!player.isAlive || !player.careerOptions?.length) return null;
  const blocked = player.careerBlockReason;
  const options = player.careerOptions.filter((o) => filter === 'all' || o.quadrant === filter);
  const preview = previewId ? player.careerOptions.find((o) => o.id === previewId) : null;

  return <section className="mx-4 mb-3 rounded-2xl border-2 border-yellow-400 bg-slate-900 p-4 text-white" aria-label="申請轉職">
    <h3 className="text-xl font-black text-yellow-200">🎯 第二專長 100，可以轉職</h3>
    {blocked ? (
      <p className="mt-2 rounded-lg bg-red-950 px-3 py-2 text-base text-red-200">目前不能申請：{blocked}</p>
    ) : (
      <p className="mt-1 text-sm text-gray-300">點職業先看薪資與代價；送出申請後由主持人在大螢幕開舞台，你確認才生效。轉職後 SK 歸零，資產、負債、人脈、住房都保留。</p>
    )}
    {preview && (
      <div className="mt-3">
        <EffectPreview title={`轉職為 ${preview.name}：效果與價值`} rows={[
          { label: '象限', value: QUADRANT_LABEL[preview.quadrant ?? ''] ?? (preview.quadrant ?? ''), tone: 'neutral' },
          { label: '月薪', value: `$${fmt(player.salary)} → ${salaryText(preview)}`, tone: 'neutral' },
          ...(preview.startingCashflow ? [{ label: '起始事業／投資現金流', value: `+$${fmt(preview.startingCashflow)}/月`, tone: 'good' as const }] : []),
          ...(preview.assetCost ? [{ label: '買入起始資產（自有資金）', value: `-$${fmt(preview.assetCost)}`, tone: 'bad' as const }] : []),
          { label: '生活支出基準', value: `$${fmt(player.expenses.otherExpenses)} → $${fmt(preview.otherExpenses ?? 0)}`, tone: 'neutral' },
          ...(preview.startingFQ ? [{ label: '財商 FQ', value: `${player.stats.financialIQ} → ${Math.max(player.stats.financialIQ, preview.startingFQ)}`, tone: 'good' as const }] : []),
          { label: '第二專長 SK', value: `${player.stats.careerSkill} → 0（重新累積）`, tone: 'bad' },
          { label: '年資加薪倍率', value: `×${(player.salaryGrowthMultiplier ?? 1).toFixed(2)} 保留`, tone: 'good' },
          { label: '行程', value: preview.flexible ? '自由行程（旅遊聯誼不限次數）' : '固定班表（每輪 1 次活動）', tone: preview.flexible ? 'good' : 'neutral' },
          { label: '生命體驗', value: '+10', tone: 'good' },
        ]} notes={['正式數字（含月現金流前後）會在主持人開舞台時顯示在大螢幕，你再確認一次', preview.canAfford === false ? '現金不足以買入起始資產' : '送出後可撤回；主持人依申請順序開舞台']}
          confirmLabel="送出轉職申請" onCancel={() => setPreviewId(null)} disabled={Boolean(blocked) || preview.canAfford === false} disabledReason={blocked ?? '現金不足'}
          onConfirm={() => { emit('requestCareerChange', { newProfessionId: preview.id }); setPreviewId(null); }} />
      </div>
    )}
    <div className="mt-3 flex gap-1">
      {(['all', 'E', 'S', 'B', 'I'] as const).map((q) => (
        <button key={q} type="button" onClick={() => setFilter(q)} className={`flex-1 rounded-lg py-1 text-sm font-bold ${filter === q ? 'bg-yellow-500 text-black' : 'bg-gray-800 text-gray-200'}`}>{q === 'all' ? '全部' : q}</button>
      ))}
    </div>
    <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => setPreviewId(o.id)}
          className={`w-full rounded-xl border p-3 text-left ${previewId === o.id ? 'border-yellow-400 bg-yellow-900/40' : o.canAfford === false ? 'border-gray-700 bg-gray-800/60' : 'border-gray-600 bg-gray-800'}`}>
          <div className="flex items-center justify-between">
            <span className="text-base font-bold">{o.name}</span>
            <span className="rounded-full bg-gray-700 px-2 py-0.5 text-xs">{o.quadrant}</span>
          </div>
          <p className="text-xs text-gray-300">月薪 {salaryText(o)}{o.startingCashflow ? `；事業現金流 +$${fmt(o.startingCashflow)}/月` : ''}{o.assetCost ? `；自有資金 $${fmt(o.assetCost)}${o.canAfford === false ? '（現金不足）' : ''}` : ''}</p>
        </button>
      ))}
    </div>
  </section>;
}
