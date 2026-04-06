import { useEffect, useMemo, useRef, useState } from 'react';
import type { PaydayFormData, PaydayPlanPayload, LifeChoice } from '../../types/game';

interface PaydayPlanFormProps {
  data: PaydayFormData;
  playerCash: number;
  onSubmit: (plan: PaydayPlanPayload, lifeChoice: LifeChoice) => void;
}

const INSURANCE_CONFIG = {
  medical:  { label: '醫療險', monthlyPremium: 200, activationFee: 400, icon: '🏥', key: 'hasMedicalInsurance' as const },
  life:     { label: '壽險',   monthlyPremium: 100, activationFee: 200, icon: '🛡️', key: 'hasLifeInsurance' as const },
  property: { label: '財產險', monthlyPremium: 300, activationFee: 600, icon: '🏠', key: 'hasPropertyInsurance' as const },
};

const DCA_AMOUNTS = [1000, 2000, 5000] as const;

export default function PaydayPlanForm({ data, playerCash, onSubmit }: PaydayPlanFormProps) {
  const [checks, setChecks] = useState({
    fqUpgrade: false,
    healthBoost: false,
    healthMaint: false,
    skillTraining: false,
    networkInvest: false,
  });
  const [dcaAmount, setDcaAmount] = useState(0);
  const [buyIns, setBuyIns] = useState<Array<'medical' | 'life' | 'property'>>([]);
  const [lifeChoice, setLifeChoice] = useState<LifeChoice>({ type: 'none' });
  const [showTravelList, setShowTravelList] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil((data.timeoutMs ?? 30000) / 1000));

  // 使用 ref 保存最新的 handleSubmit，避免計時器閉包過期
  const handleSubmitRef = useRef<() => void>(() => {});

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          handleSubmitRef.current();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const totalCost = useMemo(() => {
    let cost = 0;
    if (checks.fqUpgrade)    cost += data.affordableOptions.fqUpgrade.cost;
    if (checks.healthBoost)  cost += data.affordableOptions.healthBoost.cost;
    else if (checks.healthMaint) cost += data.affordableOptions.healthMaintenance.cost;
    if (checks.skillTraining) cost += data.affordableOptions.skillTraining.cost;
    if (checks.networkInvest) cost += data.affordableOptions.networkInvest.cost;
    cost += dcaAmount;
    for (const t of buyIns) cost += INSURANCE_CONFIG[t].activationFee;
    if (lifeChoice.type === 'travel') {
      const dest = data.travelDestinations?.find((d) => d.id === (lifeChoice as { type: 'travel'; destinationId: string; destinationName: string }).destinationId);
      if (dest) cost += dest.cost;
    }
    return cost;
  }, [checks, dcaAmount, buyIns, lifeChoice]);

  const remaining = playerCash - totalCost;

  function toggleCheck(key: keyof typeof checks) {
    setChecks((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // healthBoost 和 healthMaint 互斥
      if (key === 'healthBoost' && next.healthBoost) next.healthMaint = false;
      if (key === 'healthMaint' && next.healthMaint) next.healthBoost = false;
      return next;
    });
  }

  function toggleIns(type: 'medical' | 'life' | 'property') {
    setBuyIns((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }

  function handleSubmit() {
    const plan: PaydayPlanPayload = {
      investInFQUpgrade: checks.fqUpgrade,
      investInHealthMaintenance: checks.healthMaint,
      investInHealthBoost: checks.healthBoost,
      investInSkillTraining: checks.skillTraining,
      investInNetwork: checks.networkInvest,
      stockDCAAmount: dcaAmount,
      buyInsuranceTypes: buyIns,
    };
    onSubmit(plan, lifeChoice);
  }
  // 每次 render 都更新 ref，確保計時器用最新狀態
  handleSubmitRef.current = handleSubmit;

  const ins = data.currentInsurance;

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col overflow-hidden">
      {/* 標題列 */}
      <div className="bg-gray-800 px-4 py-3 flex items-center justify-between border-b border-gray-700">
        <div>
          <div className="text-yellow-400 font-bold text-base">
            💰 發薪日！{data.totalPaydays && data.totalPaydays > 1 ? `（第 ${data.paydayIndex ?? 1}/${data.totalPaydays} 次）` : ''}
          </div>
          <div className="text-xs text-gray-400">現金：${playerCash.toLocaleString()}</div>
        </div>
        <div className="text-right">
          <div className={`text-sm font-bold ${secondsLeft <= 10 ? 'text-red-400' : 'text-gray-300'}`}>⏱ {secondsLeft}秒</div>
          <div className="text-xs text-gray-400">自動送出</div>
        </div>
      </div>

      {/* 可捲動內容 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

        {/* ─── A. 成長投資 ─── */}
        <section>
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">成長投資</h3>
          <div className="space-y-2">
            {[
              { key: 'fqUpgrade' as const,     label: `財商升級 FQ ${data.currentStats.financialIQ}→${data.currentStats.financialIQ + 1}`, opt: data.affordableOptions.fqUpgrade,     icon: '📈' },
              { key: 'healthBoost' as const,    label: `積極健康 HP +20（現 ${data.currentStats.health}）`,                                   opt: data.affordableOptions.healthBoost,   icon: '💪' },
              { key: 'healthMaint' as const,    label: '健康維護（防 HP 衰退）',                                                               opt: data.affordableOptions.healthMaintenance, icon: '🛡' },
              { key: 'skillTraining' as const,  label: `進修培訓 SK +20（現 ${data.currentStats.careerSkill}）`,                              opt: data.affordableOptions.skillTraining, icon: '📚' },
              { key: 'networkInvest' as const,  label: `人脈拓展 NT +1（現 ${data.currentStats.network}）`,                                   opt: data.affordableOptions.networkInvest, icon: '🤝' },
            ].map(({ key, label, opt, icon }) => {
              const checked = checks[key];
              const canAfford = playerCash - (checked ? 0 : opt.cost) - totalCost + (checked ? opt.cost : 0) >= 0;
              const disabled = !opt.available || (!checked && remaining < opt.cost);
              return (
                <label
                  key={key}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    checked ? 'border-blue-500 bg-blue-900/40' : disabled ? 'border-gray-700 bg-gray-800 opacity-50' : 'border-gray-600 bg-gray-800 hover:border-blue-400'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled && !checked}
                    onChange={() => toggleCheck(key)}
                    className="accent-blue-500 w-4 h-4"
                  />
                  <span className="text-lg">{icon}</span>
                  <div className="flex-1">
                    <div className="text-sm text-white">{label}</div>
                    <div className={`text-xs ${checked || canAfford ? 'text-gray-400' : 'text-red-400'}`}>
                      費用：${opt.cost.toLocaleString()}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </section>

        {/* ─── B. 獲利投資 ─── */}
        <section>
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">獲利投資</h3>

          {/* 股票定期定額 */}
          <div className="bg-gray-800 rounded-xl p-3 mb-2 border border-gray-600">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">📊</span>
              <div>
                <div className="text-sm text-white font-semibold">股票定期定額</div>
                {data.stockDCAPortfolioValue > 0 && (
                  <div className="text-xs text-green-400">目前持倉：${data.stockDCAPortfolioValue.toLocaleString()}（每發薪日 +0.5%）</div>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setDcaAmount(0)}
                className={`flex-1 py-1.5 rounded-lg text-xs transition-colors ${dcaAmount === 0 ? 'bg-gray-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
              >不投入</button>
              {DCA_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  disabled={remaining + (dcaAmount === amt ? amt : 0) < amt}
                  onClick={() => setDcaAmount(dcaAmount === amt ? 0 : amt)}
                  className={`flex-1 py-1.5 rounded-lg text-xs transition-colors ${
                    dcaAmount === amt
                      ? 'bg-blue-600 text-white'
                      : remaining + (dcaAmount === amt ? amt : 0) < amt
                        ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                        : 'bg-gray-700 text-gray-300 hover:bg-blue-700'
                  }`}
                >${(amt / 1000).toFixed(0)}k</button>
              ))}
            </div>
          </div>

          {/* 保險購買 */}
          <div className="space-y-2">
            {(Object.entries(INSURANCE_CONFIG) as [keyof typeof INSURANCE_CONFIG, typeof INSURANCE_CONFIG[keyof typeof INSURANCE_CONFIG]][]).map(([type, cfg]) => {
              const alreadyOwned = ins[cfg.key];
              const checked = buyIns.includes(type);
              const canAfford = remaining + (checked ? cfg.activationFee : 0) >= cfg.activationFee;
              if (alreadyOwned) return null;
              return (
                <label
                  key={type}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    checked ? 'border-teal-500 bg-teal-900/40' : !canAfford ? 'border-gray-700 bg-gray-800 opacity-50' : 'border-gray-600 bg-gray-800 hover:border-teal-400'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && !canAfford}
                    onChange={() => toggleIns(type)}
                    className="accent-teal-500 w-4 h-4"
                  />
                  <span className="text-lg">{cfg.icon}</span>
                  <div className="flex-1">
                    <div className="text-sm text-white">{cfg.label}</div>
                    <div className="text-xs text-gray-400">
                      月保費 ${cfg.monthlyPremium} ｜ 啟動費 ${cfg.activationFee}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </section>

        {/* ─── C. 目前持有保險 ─── */}
        <section>
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">目前保險狀態</h3>
          <div className="grid grid-cols-3 gap-2">
            {(Object.entries(INSURANCE_CONFIG) as [keyof typeof INSURANCE_CONFIG, typeof INSURANCE_CONFIG[keyof typeof INSURANCE_CONFIG]][]).map(([type, cfg]) => {
              const owned = ins[cfg.key];
              return (
                <div key={type} className={`flex flex-col items-center p-2 rounded-xl border text-xs ${owned ? 'border-teal-500 bg-teal-900/30 text-teal-300' : 'border-gray-700 bg-gray-800 text-gray-500'}`}>
                  <span className="text-xl mb-1">{owned ? cfg.icon : '—'}</span>
                  <span>{cfg.label}</span>
                  {owned && <span className="text-teal-400">已持有</span>}
                </div>
              );
            })}
          </div>
        </section>

        {/* ─── D. 生活體驗 ─── */}
        <section>
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">生活體驗</h3>
          <div className="space-y-2">
            <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer ${lifeChoice.type === 'none' ? 'border-gray-500 bg-gray-700' : 'border-gray-600 bg-gray-800'}`}>
              <input type="radio" checked={lifeChoice.type === 'none'} onChange={() => { setLifeChoice({ type: 'none' }); setShowTravelList(false); }} className="accent-gray-400" />
              <span className="text-sm text-white">不安排</span>
            </label>
            <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer ${lifeChoice.type === 'social' ? 'border-pink-500 bg-pink-900/30' : 'border-gray-600 bg-gray-800'}`}>
              <input type="radio" checked={lifeChoice.type === 'social'} onChange={() => { setLifeChoice({ type: 'social' }); setShowTravelList(false); }} className="accent-pink-400" />
              <span className="text-lg mr-1">💫</span>
              <span className="text-sm text-white">參加聯誼活動</span>
            </label>
            <div>
              <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer ${lifeChoice.type === 'travel' ? 'border-violet-500 bg-violet-900/30' : 'border-gray-600 bg-gray-800'}`}>
                <input
                  type="radio"
                  checked={lifeChoice.type === 'travel'}
                  onChange={() => { setShowTravelList(true); setLifeChoice({ type: 'none' }); }}
                  className="accent-violet-400"
                />
                <span className="text-lg mr-1">✈️</span>
                <span className="text-sm text-white">
                  {lifeChoice.type === 'travel' ? `出發：${(lifeChoice as { type: 'travel'; destinationId: string; destinationName: string }).destinationName}` : '出國旅遊'}
                </span>
              </label>
              {showTravelList && (data.travelDestinations ?? []).length > 0 && (
                <div className="mt-2 space-y-1 pl-2">
                  {(data.travelDestinations ?? []).map((dest) => {
                    const canAffordTravel = remaining + (lifeChoice.type === 'travel' && (lifeChoice as { type: 'travel'; destinationId: string; destinationName: string }).destinationId === dest.id ? dest.cost : 0) >= dest.cost;
                    return (
                      <button
                        key={dest.id}
                        disabled={!canAffordTravel}
                        onClick={() => { setLifeChoice({ type: 'travel', destinationId: dest.id, destinationName: dest.name }); setShowTravelList(false); }}
                        className={`w-full text-left p-2 rounded-lg text-xs transition-colors ${
                          canAffordTravel ? 'bg-gray-700 hover:bg-violet-800 text-white' : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                        }`}
                      >
                        <span className="font-semibold">{dest.name}</span>
                        <span className="ml-2 text-gray-400">{dest.region} ｜ ${dest.cost.toLocaleString()} ｜ 體驗 +{dest.lifeExpGained}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* 底部固定摘要列 */}
      <div className="bg-gray-800 border-t border-gray-700 px-4 py-3">
        <div className="flex justify-between text-sm mb-3">
          <span className="text-gray-400">預計花費：<span className="text-white font-bold">${totalCost.toLocaleString()}</span></span>
          <span className={remaining < 0 ? 'text-red-400 font-bold' : 'text-gray-400'}>
            剩餘：<span className="font-bold">${remaining.toLocaleString()}</span>
          </span>
        </div>
        {/* 倒數進度條 */}
        <div className="w-full bg-gray-700 rounded-full h-1 mb-3">
          <div
            className={`h-1 rounded-full transition-all ${secondsLeft <= 10 ? 'bg-red-500' : 'bg-blue-500'}`}
            style={{ width: `${(secondsLeft / Math.ceil((data.timeoutMs ?? 30000) / 1000)) * 100}%` }}
          />
        </div>
        <button
          className="w-full py-3 rounded-xl font-bold text-sm bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          onClick={handleSubmit}
        >確認送出</button>
      </div>
    </div>
  );
}
