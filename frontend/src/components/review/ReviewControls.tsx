// 主持人的大螢幕復盤控制：依序切換步驟、逐一揭曉獎項、投影任一玩家的個人分析
import type { GameState, ReviewView } from '../../types/game';

interface Props {
  gameState: GameState | null;
  awardsCount: number;
  emit: (event: string, payload?: unknown) => void;
}

const STEPS: { view: ReviewView; label: string }[] = [
  { view: 'guide', label: '1. 復盤引導' },
  { view: 'curves', label: '2. 人生曲線' },
  { view: 'community', label: '3. 共同抉擇回顧' },
  { view: 'awards', label: '4. 隱藏獎項' },
];

export default function ReviewControls({ gameState, awardsCount, emit }: Props) {
  const current = gameState?.reviewView ?? null;
  const step = current?.step ?? 0;
  const show = (view: ReviewView, extra: Record<string, unknown> = {}) => emit('setReviewView', { view, ...extra });
  const active = (view: ReviewView, playerId?: string) =>
    current?.view === view && (playerId === undefined || current.playerId === playerId);
  const button = (on: boolean) =>
    `rounded-xl px-3 py-3 text-sm font-black transition-colors ${on ? 'bg-emerald-600 text-white ring-2 ring-emerald-300' : 'bg-gray-800 text-gray-100 hover:bg-gray-700'}`;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {STEPS.map((item) => (
          <button key={item.view} className={button(active(item.view))} onClick={() => show(item.view)}>{item.label}</button>
        ))}
      </div>
      {current?.view === 'awards' && awardsCount > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-yellow-700 bg-yellow-950/40 p-2">
          <button className="rounded-lg bg-gray-800 px-3 py-2 text-sm font-bold text-white disabled:opacity-40" disabled={step <= 0}
            onClick={() => show('awards', { step: step - 1 })}>← 上一個</button>
          <span className="flex-1 text-center text-sm font-bold text-yellow-200">獎項 {Math.min(step, awardsCount - 1) + 1}／{awardsCount}</span>
          <button className="rounded-lg bg-yellow-600 px-3 py-2 text-sm font-black text-gray-950 disabled:opacity-40" disabled={step >= awardsCount - 1}
            onClick={() => show('awards', { step: step + 1 })}>下一個 →</button>
        </div>
      )}
      <div>
        <p className="mb-1 text-xs font-bold text-gray-400">5. 個人分析（投影到大螢幕）</p>
        <div className="flex flex-wrap gap-2">
          {(gameState?.players ?? []).map((player) => (
            <button key={player.id} className={button(active('player', player.id))} onClick={() => show('player', { playerId: player.id })}>
              {player.name}
            </button>
          ))}
        </div>
      </div>
      <button className={`w-full ${button(active('ranking'))}`} onClick={() => show('ranking')}>6. 最終排名（放最後）</button>
      <div className="grid gap-2 sm:grid-cols-2">
        <button className={button(active('history'))} onClick={() => show('history')}>決策歷程（全場時間軸）</button>
        <button className={button(active('game'))} onClick={() => show('game')}>返回最終棋盤</button>
      </div>
    </div>
  );
}
