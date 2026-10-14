import { useState } from 'react';
import type { GameState, Player, CareerOption } from '../../types/game';
import EffectPreview from './EffectPreview';
import CollapsePanel from './CollapsePanel';

const fmt = (n: number) => Math.round(n).toLocaleString();
const QUADRANT_LABEL: Record<string, string> = { E: 'E 受薪族', S: 'S 自僱者', B: 'B 企業主', I: 'I 投資者' };

function salaryText(o: CareerOption): string {
  if (o.salaryType === 'random' && o.salaryRange) return `$${fmt(o.salaryRange[0])}–$${fmt(o.salaryRange[1])}（每月隨機）`;
  if (o.salaryType === 'nt_driven') return `底薪 $${fmt(o.salaryBase ?? 0)} + 人脈 × $${fmt(o.salaryPerNT ?? 0)}`;
  if (o.salaryType === 'sk_driven') return `$${fmt(o.salary ?? 0)} + 專長 × $${fmt(o.salaryPerSK ?? 0)}（保留目前 SK）`;
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
    return <section className="senior-career mx-4 mb-3 text-white" aria-label="轉職申請進度" aria-live="polite">
      <CollapsePanel key="queued" title="🎯 轉職申請進度" summary={`已申請 ${request.professionName} · 等待主持人${position > 1 ? `（第 ${position} 位）` : ''}`}>
      <p className="font-black">🎯 已申請轉職：{request.professionName}</p>
      <p className="my-2 text-base text-gray-200">{position > 1 ? `排在第 ${position} 位，` : ''}等主持人在大螢幕開啟「轉職舞台」，你再確認代價；目前沒有扣款，職業也還沒變。</p>
      <p className="mb-3 text-sm text-yellow-200">提醒主持人：後台「🎯 等待轉職」區按「開啟轉職舞台」（要等目前回合、決策與人生規劃結束）。</p>
      <button className={button} onClick={() => emit('cancelCareerRequest', { requestId: request.id })}>撤回申請</button>
      </CollapsePanel>
    </section>;
  }

  if (!player.isAlive || !player.careerOptions?.length) return null;
  const blocked = player.careerBlockReason;
  const options = player.careerOptions.filter((o) => filter === 'all' || o.quadrant === filter);
  const preview = previewId ? player.careerOptions.find((o) => o.id === previewId) : null;
  const previewBlocked = blocked || (preview?.skillGap ? `SK 還差 ${preview.skillGap}` : null)
    || (preview?.canAfford === false ? '現金不足' : null);

  return <section className="senior-career mx-4 mb-3 text-white" aria-label="申請轉職">
    <CollapsePanel key="browse" title="🎯 申請轉職" summary={`目前 SK ${player.stats.careerSkill} · ${blocked || '展開查看職業與條件'}`}>
    {blocked ? (
      <p className="mt-2 rounded-lg bg-red-950 px-3 py-2 text-base text-red-200">目前不能申請：{blocked}</p>
    ) : (
      <p className="mt-1 text-base text-gray-300">不用等人生規劃。點職業看條件，符合門檻即可申請。主持人在回合空檔開啟舞台，你確認、主持人揭曉後才生效。</p>
    )}
    <p className="mt-2 text-base text-yellow-100">轉職保留 SK、資產與負債。成功後需完成自己的 {player.careerCooldownDuration ?? 3} 次回合（含休息／跳過），才能再次申請。</p>
    {preview && (
      <div className="mt-3">
        <EffectPreview title={`轉職為 ${preview.name}：效果與價值`} rows={[
          { label: '象限', value: QUADRANT_LABEL[preview.quadrant ?? ''] ?? (preview.quadrant ?? ''), tone: 'neutral' },
          { label: '月薪', value: `$${fmt(player.salary)} → ${salaryText(preview)}`, tone: 'neutral' },
          ...(preview.startingCashflow ? [{ label: '起始事業／投資現金流', value: `+$${fmt(preview.startingCashflow)}/月`, tone: 'good' as const }] : []),
          ...(preview.assetCost ? [{ label: '買入起始資產（自有資金）', value: `-$${fmt(preview.assetCost)}`, tone: 'bad' as const }] : []),
          { label: '生活支出基準', value: `$${fmt(player.expenses.otherExpenses)} → $${fmt(preview.otherExpenses ?? 0)}`, tone: 'neutral' },
          ...(preview.startingFQ ? [{ label: '財商 FQ', value: `${player.stats.financialIQ} → ${Math.max(player.stats.financialIQ, preview.startingFQ)}`, tone: 'good' as const }] : []),
          { label: '職業 SK 門檻', value: `${preview.requiredSK ?? 100}${preview.skillGap ? `（還差 ${preview.skillGap}）` : '（已達標）'}`, tone: preview.skillGap ? 'bad' : 'good' },
          { label: '第二專長 SK', value: `${player.stats.careerSkill} 保留`, tone: 'good' },
          { label: '轉職冷卻期', value: `完成自己的 ${player.careerCooldownDuration ?? 3} 次回合`, tone: 'neutral' },
          { label: '年資加薪倍率', value: `×${(player.salaryGrowthMultiplier ?? 1).toFixed(2)} 保留`, tone: 'good' },
          { label: '行程', value: preview.flexible ? '自由行程（旅遊聯誼不限次數）' : '固定班表（每輪 1 次活動）', tone: preview.flexible ? 'good' : 'neutral' },
        ]} notes={['正式數字（含月現金流前後）會在主持人開舞台時顯示在大螢幕，你再確認一次', preview.canAfford === false ? '現金不足以買入起始資產' : '送出後可撤回；主持人依申請順序開舞台']}
          confirmLabel="送出轉職申請" onCancel={() => setPreviewId(null)} disabled={Boolean(previewBlocked)} disabledReason={previewBlocked ?? undefined}
          onConfirm={() => { emit('requestCareerChange', { newProfessionId: preview.id }); setPreviewId(null); }} />
      </div>
    )}
    <div className="senior-career-filters mt-3 grid grid-cols-5 gap-1" aria-label="職業分類">
      {(['all', 'E', 'S', 'B', 'I'] as const).map((q) => (
        <button key={q} type="button" aria-pressed={filter === q} onClick={() => setFilter(q)} className={`rounded-lg py-2 text-sm font-bold ${filter === q ? 'bg-yellow-500 text-black' : 'bg-gray-800 text-gray-200'}`}>{({all: '全部', E: '受薪', S: '自僱', B: '企業', I: '投資'})[q]}</button>
      ))}
    </div>
    <div className="mt-2 space-y-2">
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => setPreviewId(o.id)}
          className={`w-full rounded-xl border p-3 text-left ${previewId === o.id ? 'border-yellow-400 bg-yellow-900/40' : o.canAfford === false ? 'border-gray-700 bg-gray-800/60' : 'border-gray-600 bg-gray-800'}`}>
          <div className="flex items-center justify-between">
            <span className="text-base font-bold">{o.name}</span>
            <span className="rounded-full bg-gray-700 px-2 py-0.5 text-xs">{o.quadrant}</span>
          </div>
          <p className={`mt-1 text-base font-bold ${o.skillGap ? 'text-orange-200' : 'text-emerald-200'}`}>需要 SK {o.requiredSK ?? 100} · {o.skillGap ? `還差 ${o.skillGap}` : '技能已達標'}</p>
          <p className="text-sm text-gray-300">月薪基準 {salaryText(o)}{o.startingCashflow ? `；事業現金流 +$${fmt(o.startingCashflow)}/月` : ''}{o.assetCost ? `；自有資金 $${fmt(o.assetCost)}${o.canAfford === false ? '（現金不足）' : ''}` : ''}</p>
        </button>
      ))}
    </div>
    </CollapsePanel>
  </section>;
}
