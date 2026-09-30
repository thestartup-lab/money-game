// 家庭行動：主動求子、領養、助養兒童、付費婚配、主動離婚（全體行動時間進行）
import { useState } from 'react';
import type { Player } from '../../types/game';

interface Props {
  player: Player;
  canUseActions: boolean;
  emit: (event: string, payload?: unknown) => void;
}

type ActionKey = 'tryForBaby' | 'adoptChild' | 'sponsorChild' | 'buyMarriage' | 'fileDivorce';

const money = (n: number) => `$${Math.round(n).toLocaleString('zh-TW')}`;

export default function FamilyActionsCard({ player, canUseActions, emit }: Props) {
  const [confirm, setConfirm] = useState<ActionKey | null>(null);
  const f = player.actionInfo?.family;
  if (!f || !player.isAlive) return null;

  const actions: { key: ActionKey; label: string; show: boolean; blocked: string | null; lines: string[]; danger?: boolean }[] = [
    { key: 'tryForBaby', label: '👶 主動求子', show: player.isMarried, blocked: f.fertility.blocked,
      lines: [`費用 ${money(f.fertility.cost)}（檢查、療程、備孕）`, `成功機率 ${Math.round(f.fertility.chance * 100)}%，每輪可試一次`, '成功後每月多一份子女支出，家庭分數 +25'] },
    { key: 'adoptChild', label: '🏡 領養孩子', show: true, blocked: f.adoption.blocked,
      lines: [`費用 ${money(f.adoption.cost)}（評估、法律程序、安置）`, `孩子 ${f.adoption.childAge} 歲來到家裡，單身也可以`, '子女支出與家庭分數（+25）和親生一樣'] },
    { key: 'sponsorChild', label: '🤲 助養兒童', show: true, blocked: f.sponsor.blocked,
      lines: [`每月 ${money(f.sponsor.monthly)}，持續 ${f.sponsor.years} 年`, `家庭連結 +${f.sponsor.points}、體驗 +5（已助養 ${f.sponsor.count}／${f.sponsor.max}）`] },
    { key: 'buyMarriage', label: '💍 付費婚配', show: !player.isMarried, blocked: f.arranged.blocked,
      lines: [`費用 ${money(f.arranged.cost)}（年紀越大越貴）`, '直接成婚：配偶收入以實拿計，也多一份家庭支出', '體驗加分比自由戀愛少'] },
    { key: 'fileDivorce', label: '💔 主動離婚', show: player.isMarried, blocked: f.divorce.blocked, danger: true,
      lines: [`律師費 ${money(f.divorce.legalFee)}，再分走現金的 ${Math.round(f.divorce.cashShare * 100)}%`, '失去配偶收入，也不用再付配偶生活費；健康 −10', '孩子留在身邊，家庭分數少了婚姻的 25 分'] },
  ];

  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-pink-200">👨‍👩‍👧 家庭</p>
        <span className="text-[11px] text-gray-400">家庭連結 {f.familyTies}／{f.familyTieCap}（助養、照顧長輩、指導後輩）</span>
      </div>
      <p className="text-[11px] text-gray-400">家庭分數 = 婚姻 25 + 每個孩子 25（親生或領養）+ 家庭連結最多 50。不結婚、不生小孩也能拿到一半。</p>
      {actions.filter((a) => a.show).map((a) => (
        <div key={a.key} className="rounded-lg border border-gray-700 bg-gray-900 p-2">
          {confirm === a.key ? (
            <div className="space-y-1">
              <p className={`text-sm font-bold ${a.danger ? 'text-red-300' : 'text-white'}`}>{a.label}：確認</p>
              {a.lines.map((line) => <p key={line} className="text-xs text-gray-300">・{line}</p>)}
              <div className="mt-1 grid grid-cols-2 gap-2">
                <button className={`rounded-lg py-2 text-sm font-bold text-white ${a.danger ? 'bg-red-700' : 'bg-pink-700'}`}
                  onClick={() => { emit(a.key); setConfirm(null); }}>確認</button>
                <button className="rounded-lg bg-gray-700 py-2 text-sm text-white" onClick={() => setConfirm(null)}>取消</button>
              </div>
            </div>
          ) : (
            <>
              <button className="w-full rounded-lg bg-gray-800 py-2 text-sm font-semibold text-gray-100 disabled:text-gray-500"
                disabled={Boolean(a.blocked) || !canUseActions} onClick={() => setConfirm(a.key)}>{a.label}</button>
              {a.blocked ? <p className="mt-1 text-[11px] text-orange-300">{a.blocked}</p>
                : !canUseActions ? <p className="mt-1 text-[11px] text-gray-500">在全體行動時間進行。</p> : null}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
