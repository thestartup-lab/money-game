import type { GameState } from '../../types/game';
import { DEFAULT_LINE_BRAND } from '../../lineBrand';

export default function LoginPolicyPanel({ gameState, emit }: {
  gameState: GameState | null;
  emit: (event: string, payload: unknown) => void;
}) {
  if (!gameState || !['WaitingForPlayers', 'Pre20'].includes(gameState.gamePhase)) return null;
  const brand = gameState.lineBrand ?? DEFAULT_LINE_BRAND;
  return <section className="rounded-xl border border-emerald-700 bg-slate-900 p-4 text-white">
    <h2 className="text-lg font-bold">玩家登入方式</h2>
    <p className="mt-2 font-bold">場次品牌：{brand.name}（{brand.officialAccountId}）</p>
    <p className="text-sm text-slate-300">此場品牌已固定；若選錯品牌，請另外建立新場次。</p>
    <p className="my-2">{gameState.lineLoginRequired ? 'LINE 帳號登入（預設）' : '已開放臨時加入（不驗證 LINE 身分）'}</p>
    <p className="mb-3 text-sm text-slate-300">沒有 LINE 的學員，可由主持人暫時開放加入，再切回 LINE。切回不會移除已加入的臨時玩家。姓名仍需現場核對。</p>
    <button className="min-h-12 w-full rounded-lg bg-emerald-800 p-3 font-bold" onClick={() => emit('setLineLoginRequired', { enabled: !gameState.lineLoginRequired })}>
      {gameState.lineLoginRequired ? '開放臨時加入' : '切回僅限 LINE 登入'}
    </button>
  </section>;
}
