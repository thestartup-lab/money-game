import type { RoomPlayerSummary } from '../../types/game';

interface Props {
  analysis: { roomId: string; players: RoomPlayerSummary[]; currentAge: number };
}

const EVENT_ICONS: Record<string, string> = {
  asset_buy: '🏠', asset_sell: '💰', travel: '✈️',
  marriage: '💑', child: '👶', crisis: '⚠️',
  career_change: '🔄', education: '🎓', rat_race_escaped: '🚀',
  loan_taken: '🏦', franchise: '🏪', relationship: '🤝',
};

const EVENT_COLORS: Record<string, string> = {
  asset_buy: 'border-emerald-700 bg-emerald-950',
  asset_sell: 'border-yellow-700 bg-yellow-950',
  travel: 'border-blue-700 bg-blue-950',
  marriage: 'border-pink-700 bg-pink-950',
  child: 'border-pink-600 bg-pink-950',
  crisis: 'border-red-700 bg-red-950',
  career_change: 'border-purple-700 bg-purple-950',
  education: 'border-indigo-700 bg-indigo-950',
  rat_race_escaped: 'border-emerald-500 bg-emerald-900',
  loan_taken: 'border-orange-700 bg-orange-950',
  franchise: 'border-amber-700 bg-amber-950',
  relationship: 'border-teal-700 bg-teal-950',
};

const DOT_COLORS = [
  'bg-amber-400', 'bg-blue-400', 'bg-pink-400',
  'bg-emerald-400', 'bg-purple-400', 'bg-orange-400',
];

const fmt = (n: number) => n.toLocaleString('zh-TW', { maximumFractionDigits: 0 });

export default function DecisionHistoryView({ analysis }: Props) {
  const players = analysis.players;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">📖 決策歷程回顧</h2>
        <p className="text-xs text-gray-500">展示每位參與者的關鍵決策時間軸</p>
      </div>

      {/* 玩家欄位：橫向排列，各自捲動 */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {players.map((player, idx) => (
          <div key={player.playerId} className="flex-shrink-0 w-72">
            {/* 玩家標題 */}
            <div className="flex items-center gap-2 mb-3 sticky top-0 bg-gray-950 py-1 z-10">
              <span className={`w-3 h-3 rounded-full ${DOT_COLORS[idx % DOT_COLORS.length]}`} />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-white text-sm truncate">{player.playerName}</p>
                <p className="text-xs text-gray-500 truncate">{player.profession}（{player.quadrant}）</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-lg font-black text-emerald-400">{Math.round(player.score.total)}</p>
                <p className="text-xs text-gray-500">分</p>
              </div>
            </div>

            {/* 最終結果 */}
            <div className="rounded-xl bg-gray-800 border border-gray-700 px-3 py-2 mb-3 text-xs space-y-0.5">
              <p className="text-gray-400">最終淨資產：<span className={`font-bold ${player.finalNetWorth >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>${fmt(player.finalNetWorth)}</span></p>
              <p className="text-gray-400">月現金流：<span className={`font-bold ${player.finalCashflow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>${fmt(player.finalCashflow)}</span></p>
              <p className="text-gray-400">
                {player.escapedRatRace ? '🚀 脫出老鼠賽跑' : '⏳ 內圈作戰'}
                {!player.isAlive ? ' • ⚰️ 人生結束' : ' • 🎂 活到最後'}
              </p>
            </div>

            {/* 事件時間軸 */}
            {player.eventLog && player.eventLog.length > 0 ? (
              <div className="relative pl-4 space-y-2">
                <div className="absolute left-1.5 top-2 bottom-2 w-px bg-gray-700" />
                {player.eventLog.map((ev, evIdx) => {
                  const icon = EVENT_ICONS[ev.type] ?? '📌';
                  const colorClass = EVENT_COLORS[ev.type] ?? 'border-gray-700 bg-gray-900';
                  const cashChange = ev.cashAfter - ev.cashBefore;
                  const cfChange = ev.cashflowAfter - ev.cashflowBefore;
                  return (
                    <div key={evIdx} className={`relative rounded-lg border ${colorClass} px-2.5 py-2`}>
                      <div className="absolute -left-[22px] top-2.5 w-4 h-4 rounded-full bg-gray-950 border-2 border-gray-600 flex items-center justify-center text-xs">
                        {icon}
                      </div>
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-xs text-gray-300 leading-snug flex-1">{ev.description}</p>
                        <span className="text-xs text-gray-500 font-mono flex-shrink-0">{ev.age}歲</span>
                      </div>
                      {(cashChange !== 0 || cfChange !== 0) && (
                        <div className="flex gap-2 mt-1 text-xs">
                          {cashChange !== 0 && (
                            <span className={cashChange > 0 ? 'text-emerald-400' : 'text-red-400'}>
                              現金 {cashChange > 0 ? '+' : ''}{fmt(cashChange)}
                            </span>
                          )}
                          {cfChange !== 0 && (
                            <span className={cfChange > 0 ? 'text-blue-400' : 'text-orange-400'}>
                              月流 {cfChange > 0 ? '+' : ''}{fmt(cfChange)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-600 text-center py-8">無關鍵決策記錄</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
