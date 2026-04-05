import { useEffect, useState } from 'react';
import type { ActiveEvent } from '../../types/game';

interface EventCardProps {
  event: ActiveEvent;
  onDecision: (decision: Record<string, unknown>) => void;
  onDismiss: () => void;
}

const borderColors: Record<string, string> = {
  doodad:              'border-red-500',
  crisis_nt_skip:      'border-orange-500',
  crisis_applied:      'border-red-600',
  deal_pick:           'border-green-500',
  charity:             'border-pink-500',
  tech_startup_offer:  'border-blue-500',
  tech_startup_result_success: 'border-green-400',
  tech_startup_result_fail:    'border-red-400',
  asset_leverage:      'border-emerald-500',
  disease_crisis:      'border-purple-500',
  global_event:        'border-orange-400',
};

export default function EventCard({ event, onDecision, onDismiss }: EventCardProps) {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    setSelectedCardId(null);
    if (event.kind === 'crisis_nt_skip') {
      const secs = Math.ceil(event.timeoutMs / 1000);
      setSecondsLeft(secs);
      const interval = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev === null || prev <= 1) {
            clearInterval(interval);
            onDecision({ useNTSkip: false });
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [event]);

  const borderClass =
    event.kind === 'tech_startup_result'
      ? event.success ? borderColors.tech_startup_result_success : borderColors.tech_startup_result_fail
      : borderColors[event.kind] ?? 'border-gray-500';

  return (
    <div className={`w-full rounded-2xl border-2 ${borderClass} bg-gray-800 p-4 space-y-3`}>
      {event.kind === 'doodad' && (
        <>
          <div className="text-red-400 font-bold text-base">💸 {event.title}</div>
          <p className="text-sm text-gray-300">{event.description}</p>
          {event.cashDeducted > 0 && (
            <p className="text-sm text-red-300">現金損失：<span className="font-bold">-${event.cashDeducted.toLocaleString()}</span></p>
          )}
          {event.expenseIncrease > 0 && (
            <p className="text-sm text-orange-300">月支出增加：<span className="font-bold">+${event.expenseIncrease.toLocaleString()}/月</span></p>
          )}
          <button className="w-full btn-secondary py-2 rounded-xl text-sm" onClick={onDismiss}>確認</button>
        </>
      )}

      {event.kind === 'crisis_nt_skip' && (
        <>
          <div className="flex justify-between items-center">
            <span className="text-orange-400 font-bold text-base">⚠️ 危機事件</span>
            {secondsLeft !== null && <span className="text-xs text-gray-400">⏱ {secondsLeft}秒</span>}
          </div>
          <p className="text-sm font-semibold text-white">{event.title}</p>
          <p className="text-sm text-gray-300">{event.description}</p>
          <p className="text-sm text-red-300">未保險費用：<span className="font-bold">${event.baseCost.toLocaleString()}</span></p>
          <p className="text-sm text-blue-300">人脈值：<span className="font-bold">{event.network}</span>（≥3 可跳過）</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              className="py-2 rounded-xl text-sm bg-blue-700 hover:bg-blue-600 text-white"
              onClick={() => onDecision({ useNTSkip: true })}
            >使用人脈跳過</button>
            <button
              className="py-2 rounded-xl text-sm bg-gray-700 hover:bg-gray-600 text-white"
              onClick={() => onDecision({ useNTSkip: false })}
            >接受損失</button>
          </div>
        </>
      )}

      {event.kind === 'crisis_applied' && (
        <>
          <div className="text-red-400 font-bold text-base">🆘 {event.title}</div>
          <p className="text-sm text-gray-300">{event.description}</p>
          <p className="text-sm text-red-300">實際費用：<span className="font-bold">-${event.effectiveCost.toLocaleString()}</span></p>
          {event.turnsLost > 0 && (
            <p className="text-sm text-orange-300">跳過 {event.turnsLost} 個回合</p>
          )}
          {event.wasInsured && (
            <p className="text-sm text-green-400">✅ 保險已減免大部分費用</p>
          )}
          <button className="w-full btn-secondary py-2 rounded-xl text-sm" onClick={onDismiss}>確認</button>
        </>
      )}

      {event.kind === 'deal_pick' && (
        <>
          <div className="text-green-400 font-bold text-base">📋 交易機會</div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-400">手頭現金</span>
            <span className="font-bold text-emerald-400">${event.playerCash.toLocaleString()}</span>
          </div>
          <p className="text-xs text-gray-400">選擇一張交易牌或拒絕</p>
          <div className="space-y-2">
            {event.cards.map((card) => {
              const canAfford = event.playerCash >= (card.downPayment ?? 0);
              const remaining = event.playerCash - (card.downPayment ?? 0);
              return (
                <button
                  key={card.id}
                  className={`w-full text-left p-3 rounded-xl border text-sm transition-colors ${
                    selectedCardId === card.id
                      ? 'border-green-400 bg-green-900'
                      : canAfford
                        ? 'border-gray-600 bg-gray-700 hover:border-green-500'
                        : 'border-red-800 bg-gray-800 opacity-60 cursor-not-allowed'
                  }`}
                  onClick={() => canAfford && setSelectedCardId(card.id)}
                  disabled={!canAfford}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white">{card.name}</span>
                    {!canAfford && <span className="text-xs text-red-400">現金不足</span>}
                  </div>
                  {card.description && <div className="text-gray-400 text-xs mb-1">{card.description}</div>}
                  <div className="text-gray-300 text-xs">
                    頭期款：<span className={canAfford ? 'text-yellow-300' : 'text-red-400'}>${(card.downPayment ?? 0).toLocaleString()}</span>
                    {'  '}月現金流：
                    <span className={card.monthlyCashflow >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {card.monthlyCashflow >= 0 ? '+' : ''}${(card.monthlyCashflow ?? 0).toLocaleString()}
                    </span>
                  </div>
                  {canAfford && selectedCardId === card.id && (
                    <div className="text-xs text-gray-400 mt-0.5">支付後剩餘：<span className="text-emerald-400">${remaining.toLocaleString()}</span></div>
                  )}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className={`py-2 rounded-xl text-sm ${selectedCardId ? 'bg-green-700 hover:bg-green-600 text-white' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`}
              disabled={!selectedCardId}
              onClick={() => selectedCardId && onDecision({ accepted: true, selectedCardId })}
            >接受交易</button>
            <button
              className="py-2 rounded-xl text-sm bg-gray-700 hover:bg-gray-600 text-white"
              onClick={() => onDecision({ accepted: false })}
            >拒絕</button>
          </div>
        </>
      )}

      {event.kind === 'charity' && (
        <>
          <div className="text-pink-400 font-bold text-base">❤️ 慈善機會</div>
          <p className="text-sm text-gray-300">捐出現金流的 10%，獲得生命體驗與傳承加成</p>
          <p className="text-sm text-white">捐款金額：<span className="font-bold text-pink-300">${event.amount.toLocaleString()}</span></p>
          <p className="text-xs text-gray-400">效益：生命體驗 +15、傳承分 +5</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              className="py-2 rounded-xl text-sm bg-pink-700 hover:bg-pink-600 text-white"
              onClick={() => onDecision({ donate: true })}
            >捐款</button>
            <button
              className="py-2 rounded-xl text-sm bg-gray-700 hover:bg-gray-600 text-white"
              onClick={() => onDecision({ donate: false })}
            >跳過</button>
          </div>
        </>
      )}

      {event.kind === 'tech_startup_offer' && (
        <>
          <div className="text-blue-400 font-bold text-base">💡 科技新創機會</div>
          <p className="text-sm text-gray-300">投入資金入股新創企業。擲骰 ≥4 成功，月現金流 +{Math.round(event.investmentAmount * 0.1).toLocaleString()}。</p>
          <p className="text-sm text-white">投資金額：<span className="font-bold text-blue-300">${event.investmentAmount.toLocaleString()}</span></p>
          <p className="text-sm text-gray-400">現有現金：${event.playerCash.toLocaleString()}</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              className={`py-2 rounded-xl text-sm ${event.playerCash >= event.investmentAmount ? 'bg-blue-700 hover:bg-blue-600 text-white' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`}
              disabled={event.playerCash < event.investmentAmount}
              onClick={() => onDecision({ invest: true })}
            >投資</button>
            <button
              className="py-2 rounded-xl text-sm bg-gray-700 hover:bg-gray-600 text-white"
              onClick={() => onDecision({ invest: false })}
            >跳過</button>
          </div>
        </>
      )}

      {event.kind === 'tech_startup_result' && (
        <>
          <div className={`font-bold text-base ${event.success ? 'text-green-400' : 'text-red-400'}`}>
            {event.success ? '🎉 投資成功！' : '😔 投資失敗'}
          </div>
          <p className="text-sm text-gray-300">骰子點數：<span className="font-bold">{event.diceRoll}</span>（需 ≥4）</p>
          <p className="text-sm text-gray-300">投入金額：${event.investmentAmount.toLocaleString()}</p>
          {event.success && event.monthlyCashflow !== undefined && (
            <p className="text-sm text-green-300">每月現金流 +${event.monthlyCashflow.toLocaleString()}</p>
          )}
          {!event.success && (
            <p className="text-sm text-red-300">損失 ${event.investmentAmount.toLocaleString()}</p>
          )}
          <button className="w-full btn-secondary py-2 rounded-xl text-sm" onClick={onDismiss}>確認</button>
        </>
      )}

      {event.kind === 'asset_leverage' && (
        <>
          <div className="text-emerald-400 font-bold text-base">🚀 資產槓桿</div>
          <p className="text-sm text-gray-300">以現有資產為槓桿，獲得一次性現金獎勵</p>
          {event.passiveIncome > 0 ? (
            <p className="text-sm text-gray-400">被動收入 ${event.passiveIncome.toLocaleString()} × 3</p>
          ) : (
            <p className="text-sm text-gray-400">基礎獎勵（無被動收入時）</p>
          )}
          <p className="text-sm text-emerald-300">獲得現金：<span className="font-bold text-lg">+${event.bonus.toLocaleString()}</span></p>
          <button className="w-full btn-secondary py-2 rounded-xl text-sm" onClick={onDismiss}>確認</button>
        </>
      )}

      {event.kind === 'disease_crisis' && (
        <>
          <div className="text-purple-400 font-bold text-base">🏥 {event.title}</div>
          <p className="text-sm text-gray-300">{event.description}</p>
          <p className="text-sm text-red-300">HP：{event.hpBefore} → <span className="font-bold">{event.hpAfter}</span>（-{event.hpBefore - event.hpAfter}）</p>
          <p className="text-sm text-red-300">醫療費用：<span className="font-bold">-${event.effectiveCost.toLocaleString()}</span></p>
          {event.turnsLost > 0 && (
            <p className="text-sm text-orange-300">休養 {event.turnsLost} 個回合</p>
          )}
          {event.wasInsured
            ? <p className="text-sm text-green-400">✅ 醫療險已減免費用</p>
            : <p className="text-sm text-yellow-400">⚠️ 建議購買醫療險以降低風險</p>
          }
          <button className="w-full btn-secondary py-2 rounded-xl text-sm" onClick={onDismiss}>確認</button>
        </>
      )}

      {event.kind === 'global_event' && (
        <>
          <div className="text-orange-400 font-bold text-base">🌍 全局事件：{event.title}</div>
          <p className="text-sm text-gray-300">{event.description}</p>
          <p className="text-xs text-orange-300 mt-1">此事件影響所有玩家的資產與現金流。</p>
          <button className="w-full btn-secondary py-2 rounded-xl text-sm" onClick={onDismiss}>確認</button>
        </>
      )}
    </div>
  );
}
