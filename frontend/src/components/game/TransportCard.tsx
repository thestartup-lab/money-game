// 交通：沒車付交通費；可以買代步車、進口車、跑車（貸款或現金），也可以賣二手車
import { useState } from 'react';
import type { Player } from '../../types/game';

interface Props { player: Player; canUseActions: boolean; emit: (event: string, payload?: unknown) => void }

const money = (n: number) => `$${Math.round(n).toLocaleString('zh-TW')}`;

export default function TransportCard({ player, canUseActions, emit }: Props) {
  const [pick, setPick] = useState<string | null>(null);
  const [confirmSell, setConfirmSell] = useState(false);
  const t = player.actionInfo?.transport;
  if (!t || !player.isAlive) return null;
  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-sky-200">🚗 交通</p>
        <span className="text-[11px] text-gray-400">每月 {money(t.monthly)}</span>
      </div>
      {t.car ? (
        <div className="rounded-lg bg-gray-900 p-2 text-xs text-gray-300">
          <p className="font-bold text-white">{t.car.name}{t.car.workVehicle ? '（工作用）' : ''}</p>
          <p>養車費每月 {money(t.monthly)}；二手價約 {money(t.resaleValue)}{t.loanRemaining ? `，車貸還欠 ${money(t.loanRemaining)}` : ''}</p>
          <p className="text-gray-400">車子每年折舊 15%。賣掉後改付交通費，約每月 {money(t.transitFee)}。</p>
          {confirmSell ? (
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button className="rounded-lg bg-red-700 py-1.5 text-sm font-bold text-white" onClick={() => { emit('sellCar'); setConfirmSell(false); }}>
                確認賣出（淨得 {money(t.resaleValue - t.loanRemaining)}）
              </button>
              <button className="rounded-lg bg-gray-700 py-1.5 text-sm text-white" onClick={() => setConfirmSell(false)}>取消</button>
            </div>
          ) : (
            <button className="mt-1 w-full rounded-lg border border-gray-600 py-1.5 text-xs text-gray-200 disabled:text-gray-500"
              disabled={!canUseActions} onClick={() => setConfirmSell(true)}>賣掉這台車</button>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-400">目前沒有車，搭大眾運輸與計程車：每月交通費 {money(t.transitFee)}（配偶與未成年孩子各多一半，隨物價上漲）。</p>
      )}
      {!t.car && (
        <div className="space-y-1.5">
          {t.offers.map((o) => (
            <div key={o.id} className="rounded-lg border border-gray-700 bg-gray-900 p-2 text-xs">
              <button className="flex w-full items-center justify-between text-left" onClick={() => setPick(pick === o.id ? null : o.id)}>
                <span className="font-bold text-white">{o.name}</span>
                <span className="text-gray-400">{money(o.price)}</span>
              </button>
              {pick === o.id && (
                <div className="mt-1 space-y-0.5 text-gray-300">
                  <p>頭期款 {money(o.downPayment)}，車貸每月 {money(o.loanMonthly)}（5 年）</p>
                  <p>養車費每月 {money(o.runningCost)}；有車就不用付交通費 {money(o.transitSaved)}</p>
                  <p className={o.monthlyWithLoan > o.transitSaved ? 'text-orange-300' : 'text-emerald-300'}>
                    貸款期間每月合計 {money(o.monthlyWithLoan)}，比現在{o.monthlyWithLoan > o.transitSaved ? '多' : '少'} {money(Math.abs(o.monthlyWithLoan - o.transitSaved))}
                  </p>
                  {o.lifeExpPerRound > 0 && <p className="text-pink-300">開好車的享受：每輪體驗 +{o.lifeExpPerRound}</p>}
                  {o.reason ? <p className="text-orange-300">{o.reason}</p> : (
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <button className="rounded-lg bg-sky-700 py-1.5 font-bold text-white disabled:bg-gray-800 disabled:text-gray-500" disabled={!canUseActions || !o.canLoan}
                        onClick={() => { emit('buyCar', { optionId: o.id }); setPick(null); }}>貸款買</button>
                      <button className="rounded-lg bg-emerald-700 py-1.5 font-bold text-white disabled:bg-gray-800 disabled:text-gray-500" disabled={!canUseActions || !o.canCash}
                        onClick={() => { emit('buyCar', { optionId: o.id, payCash: true }); setPick(null); }}>現金買</button>
                    </div>
                  )}
                  {!canUseActions && !o.reason && <p className="text-gray-500">在全體行動時間購買。</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
