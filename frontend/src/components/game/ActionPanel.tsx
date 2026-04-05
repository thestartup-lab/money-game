import { useState } from 'react';
import type { Player } from '../../types/game';

const DESTINATIONS = [
  { id: 'taiwan_cycling',   name: '台灣環島',   tier: 'inner', cost: 1000,  lifeExp: 8,  region: '亞太', desc: '騎單車環島',            special: '' },
  { id: 'japan_tokyo',      name: '日本東京',   tier: 'inner', cost: 2500,  lifeExp: 12, region: '亞太', desc: 'NT+1',                   special: '人脈+1' },
  { id: 'thailand_bangkok', name: '泰國曼谷',   tier: 'inner', cost: 1500,  lifeExp: 10, region: '亞太', desc: '東南亞文化',              special: '' },
  { id: 'korea_seoul',      name: '韓國首爾',   tier: 'inner', cost: 2000,  lifeExp: 10, region: '亞太', desc: '韓流體驗',               special: '' },
  { id: 'malaysia_kl',      name: '馬來西亞',   tier: 'inner', cost: 1500,  lifeExp: 9,  region: '亞太', desc: '美食天堂',               special: '' },
  { id: 'hong_kong',        name: '香港',       tier: 'inner', cost: 1200,  lifeExp: 8,  region: '亞太', desc: 'FQ+1',                   special: '財商+1' },
  { id: 'vietnam_hanoi',    name: '越南河內',   tier: 'inner', cost: 1000,  lifeExp: 8,  region: '亞太', desc: '歷史古城',               special: '' },
  { id: 'bali',             name: '峇里島',     tier: 'inner', cost: 2000,  lifeExp: 11, region: '亞太', desc: 'HP+5 療癒之旅',          special: 'HP+5' },
  { id: 'singapore',        name: '新加坡',     tier: 'inner', cost: 2500,  lifeExp: 10, region: '亞太', desc: 'FQ+1',                   special: '財商+1' },
  { id: 'australia_sydney', name: '澳洲雪梨',   tier: 'inner', cost: 4000,  lifeExp: 14, region: '亞太', desc: '南半球大都市',            special: '' },
  { id: 'france_paris',     name: '法國巴黎',   tier: 'outer', cost: 8000,  lifeExp: 20, region: '歐洲', desc: 'NT+2',                   special: '人脈+2' },
  { id: 'usa_newyork',      name: '美國紐約',   tier: 'outer', cost: 9000,  lifeExp: 20, region: '北美', desc: 'FQ+2 金融洞察',          special: '財商+2' },
  { id: 'africa_safari',    name: '非洲獵遊',   tier: 'outer', cost: 15000, lifeExp: 30, region: '非洲', desc: 'SK+1 視野拓展',          special: '技能+1' },
  { id: 'antarctica',       name: '南極探險',   tier: 'outer', cost: 30000, lifeExp: 50, region: '極地', desc: '傳承分+10（稀有）',      special: '傳承+10' },
  { id: 'italy_culture',    name: '義大利文化', tier: 'outer', cost: 10000, lifeExp: 22, region: '歐洲', desc: 'NT+2',                   special: '人脈+2' },
  { id: 'uae_dubai',        name: '中東杜拜',   tier: 'outer', cost: 12000, lifeExp: 22, region: '中東', desc: 'FQ+1',                   special: '財商+1' },
  { id: 'peru_machu',       name: '南美洲秘魯', tier: 'outer', cost: 12000, lifeExp: 25, region: '南美', desc: '印加古文明',              special: '' },
  { id: 'world_cruise',     name: '環遊世界',   tier: 'outer', cost: 50000, lifeExp: 80, region: '全球', desc: '全屬性+1（人生夢想）',   special: '全屬性+1' },
  { id: 'japan_fuji',       name: '富士山朝聖', tier: 'outer', cost: 5000,  lifeExp: 18, region: '亞太', desc: 'HP+10 精神修復',         special: 'HP+10' },
  { id: 'silicon_valley',   name: '矽谷考察',   tier: 'outer', cost: 10000, lifeExp: 20, region: '北美', desc: 'FQ+3，可觸發創業事件',  special: '財商+3' },
] as const;

const INSURANCE_COSTS: Record<'medical' | 'life' | 'property', number> = {
  medical: 400,
  life: 200,
  property: 600,
};
const INSURANCE_LABELS: Record<'medical' | 'life' | 'property', string> = {
  medical: '🏥 醫療險',
  life: '🛡 壽險',
  property: '🏠 財產險',
};

const DCA_AMOUNTS = [1000, 2000, 5000] as const;
const LOAN_AMOUNTS = [5000, 10000, 20000, 30000, 50000] as const;

function getLoanLimit(score: number): number {
  if (score >= 750) return 80000;
  if (score >= 650) return 50000;
  if (score >= 550) return 30000;
  if (score >= 300) return 10000;
  return 5000;
}
function getLoanRate(score: number): number {
  if (score >= 750) return 0.005;
  if (score >= 650) return 0.008;
  if (score >= 550) return 0.012;
  return 0.020;
}

const fmt = (n: number) => n.toLocaleString();

interface Props {
  player: Player;
  currentAge: number;
  onTravel: (destinationId: string) => void;
  onSocialEvent: () => void;
  onBuyInsurance: (type: 'medical' | 'life' | 'property') => void;
  onTakeEmergencyLoan: (amount: number) => void;
  onInvestStockDCA: (amount: number) => void;
  onRequestAnalysis: () => void;
  isGameOver: boolean;
}

export default function ActionPanel({
  player,
  currentAge,
  onTravel,
  onSocialEvent,
  onBuyInsurance,
  onTakeEmergencyLoan,
  onInvestStockDCA,
  onRequestAnalysis,
  isGameOver,
}: Props) {
  const [showTravelPanel, setShowTravelPanel] = useState(false);
  const [insuranceConfirm, setInsuranceConfirm] = useState<'medical' | 'life' | 'property' | null>(null);
  const [showLoanPanel, setShowLoanPanel] = useState(false);
  const [showDCAPanel, setShowDCAPanel] = useState(false);

  const noTokensLeft = !player.hasFlexibleSchedule && player.actionTokensThisPayday <= 0;
  const scheduleLabel = player.hasFlexibleSchedule
    ? '自由行程（不限次數）'
    : `本發薪日剩餘活動：${player.actionTokensThisPayday} 次`;

  const travelDisabled = player.isBedridden || player.stats.health < 20 || noTokensLeft;
  const socialDisabled = player.isBedridden || player.isMarried || noTokensLeft;

  const availableDestinations = DESTINATIONS.filter((d) =>
    d.tier === 'inner' || (d.tier === 'outer' && player.isInFastTrack)
  );
  const visited = new Set(player.visitedDestinations ?? []);

  const loanLimit = getLoanLimit(player.creditScore);
  const loanRate = getLoanRate(player.creditScore);
  const existingLoanTotal = player.liabilities?.reduce((s, l) => s + l.totalDebt, 0) ?? 0;
  const availableLoan = Math.max(0, loanLimit - existingLoanTotal);

  const dcaPortfolioValue = player.assets?.find((a) => a.id === 'stock-dca')?.currentValue ?? 0;

  return (
    <div className="space-y-3">
      {/* ── 現金狀態列 ─────────────────── */}
      <div className="rounded-xl bg-gray-800 border border-gray-600 px-4 py-3 flex items-center justify-between">
        <span className="text-sm text-gray-400">手頭現金</span>
        <span className={`text-xl font-bold tabular-nums ${player.cash < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
          ${fmt(player.cash)}
        </span>
      </div>

      {/* ── 主動行動 ──────────────────── */}
      {!isGameOver && (
        <div className="card">
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs text-gray-400">主動行動</p>
            <span className={`text-xs px-2 py-0.5 rounded-full ${player.hasFlexibleSchedule ? 'bg-green-900 text-green-300' : noTokensLeft ? 'bg-red-900 text-red-300' : 'bg-yellow-900 text-yellow-300'}`}>
              {scheduleLabel}
            </span>
          </div>

          {showTravelPanel ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-white font-semibold">選擇目的地</p>
                <button className="text-xs text-gray-400 underline" onClick={() => setShowTravelPanel(false)}>收起</button>
              </div>
              {player.isInFastTrack && (
                <p className="text-xs text-yellow-400">✨ 外圈玩家可前往全球頂級目的地</p>
              )}
              <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                {availableDestinations.map((d) => {
                  const alreadyVisited = visited.has(d.id);
                  const canAfford = player.cash >= d.cost;
                  return (
                    <button
                      key={d.id}
                      disabled={!canAfford || travelDisabled}
                      onClick={() => { onTravel(d.id); setShowTravelPanel(false); }}
                      className={`w-full text-left rounded-xl p-2.5 border transition-colors ${
                        d.tier === 'outer'
                          ? 'bg-yellow-900 border-yellow-700 hover:bg-yellow-800'
                          : 'bg-gray-800 border-gray-700 hover:bg-gray-700'
                      } ${!canAfford || travelDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`font-semibold text-sm ${d.tier === 'outer' ? 'text-yellow-200' : 'text-white'}`}>
                          {d.name} {alreadyVisited ? '✓' : ''}
                        </span>
                        <span className="text-xs text-gray-400">${fmt(d.cost)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-emerald-400">+{alreadyVisited ? Math.floor(d.lifeExp / 2) : d.lifeExp} 體驗值</span>
                        {d.special && <span className="text-[10px] text-blue-300">{d.special}</span>}
                        <span className="text-[10px] text-gray-500 ml-auto">{d.region}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                className="btn-secondary text-sm"
                disabled={travelDisabled}
                onClick={() => setShowTravelPanel(true)}
                title={travelDisabled ? '臥床、健康值不足或本日已無活動次數' : '選擇目的地出遊'}
              >
                ✈️ 出國旅遊
              </button>
              <button
                className="btn-secondary text-sm"
                disabled={socialDisabled}
                onClick={onSocialEvent}
                title={socialDisabled ? '臥床、已婚或本日已無活動次數' : '累積深度關係值'}
              >
                💑 參加聯誼
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── 保險 ─────────────────────── */}
      {!isGameOver && (
        <div className="card">
          <p className="text-xs text-gray-400 mb-2">保險</p>

          {/* 確認面板 */}
          {insuranceConfirm ? (
            <div className="rounded-xl bg-gray-700 border border-yellow-600 p-3 space-y-2">
              <p className="text-sm text-white font-semibold">確認購買 {INSURANCE_LABELS[insuranceConfirm]}</p>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">啟動費</span>
                <span className="text-red-400 font-bold">-${fmt(INSURANCE_COSTS[insuranceConfirm])}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">目前現金</span>
                <span className="text-white">${fmt(player.cash)}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-gray-600 pt-2">
                <span className="text-gray-400">剩餘現金</span>
                <span className={`font-bold ${player.cash - INSURANCE_COSTS[insuranceConfirm] < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  ${fmt(player.cash - INSURANCE_COSTS[insuranceConfirm])}
                </span>
              </div>
              {player.cash < INSURANCE_COSTS[insuranceConfirm] && (
                <p className="text-xs text-red-400">⚠️ 現金不足，無法購買</p>
              )}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  className="btn-secondary text-sm"
                  onClick={() => setInsuranceConfirm(null)}
                >
                  取消
                </button>
                <button
                  className="btn-primary text-sm"
                  disabled={player.cash < INSURANCE_COSTS[insuranceConfirm]}
                  onClick={() => { onBuyInsurance(insuranceConfirm); setInsuranceConfirm(null); }}
                >
                  確認購買
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {(['medical', 'life', 'property'] as const).map((type) => {
                const owned = type === 'medical' ? player.insurance.hasMedicalInsurance
                  : type === 'life' ? player.insurance.hasLifeInsurance
                  : player.insurance.hasPropertyInsurance;
                return (
                  <button
                    key={type}
                    className={`text-xs py-2 rounded-lg transition-colors ${owned ? 'bg-teal-800 text-teal-200 cursor-default' : 'btn-secondary'}`}
                    onClick={() => { if (!owned) setInsuranceConfirm(type); }}
                  >
                    {INSURANCE_LABELS[type]}<br />
                    <span className={owned ? 'text-teal-300' : 'text-gray-400'}>
                      {owned ? '已投保' : `$${fmt(INSURANCE_COSTS[type])}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 股票定期定額 ──────────────── */}
      {!isGameOver && (
        <div className="card">
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs text-gray-400">股票定期定額</p>
            {dcaPortfolioValue > 0 && (
              <span className="text-xs text-emerald-400">持倉 ${fmt(Math.round(dcaPortfolioValue))}</span>
            )}
          </div>

          {showDCAPanel ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-400">選擇每次投入金額（指數基金，年均報酬約 6%）</p>
              <div className="grid grid-cols-3 gap-2">
                {DCA_AMOUNTS.map((amt) => {
                  const canAfford = player.cash >= amt;
                  return (
                    <button
                      key={amt}
                      disabled={!canAfford}
                      onClick={() => { onInvestStockDCA(amt); setShowDCAPanel(false); }}
                      className={`rounded-lg py-2 text-sm font-semibold border transition-colors ${
                        canAfford
                          ? 'bg-blue-900 border-blue-700 text-blue-200 hover:bg-blue-800'
                          : 'bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed'
                      }`}
                    >
                      ${fmt(amt)}
                      {canAfford && (
                        <div className="text-[10px] text-gray-400 font-normal">
                          剩 ${fmt(player.cash - amt)}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              <button className="text-xs text-gray-400 underline" onClick={() => setShowDCAPanel(false)}>取消</button>
            </div>
          ) : (
            <button
              className="btn-secondary w-full text-sm"
              onClick={() => setShowDCAPanel(true)}
            >
              📈 投入股票定期定額
            </button>
          )}
        </div>
      )}

      {/* ── 銀行應急借款 ──────────────── */}
      {!isGameOver && (
        <div className="card">
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs text-gray-400">銀行應急借款</p>
            <span className="text-xs text-gray-500">
              信用分 {player.creditScore} ／ 利率 {(loanRate * 100).toFixed(1)}%/月
            </span>
          </div>

          {showLoanPanel ? (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>可借上限：${fmt(availableLoan)}</span>
                <span>現有負債：${fmt(existingLoanTotal)}</span>
              </div>
              {availableLoan <= 0 ? (
                <p className="text-xs text-red-400 text-center py-2">已達借款上限，無法再借</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {LOAN_AMOUNTS.filter((a) => a <= availableLoan).map((amt) => {
                    const monthly = Math.round(amt * loanRate);
                    return (
                      <button
                        key={amt}
                        onClick={() => { onTakeEmergencyLoan(amt); setShowLoanPanel(false); }}
                        className="rounded-lg py-2 px-3 text-left text-sm border bg-orange-950 border-orange-800 text-orange-200 hover:bg-orange-900 transition-colors"
                      >
                        <div className="font-semibold">${fmt(amt)}</div>
                        <div className="text-[10px] text-orange-400">月付 ${fmt(monthly)}</div>
                        <div className="text-[10px] text-gray-400">剩 ${fmt(player.cash + amt)}</div>
                      </button>
                    );
                  })}
                </div>
              )}
              <button className="text-xs text-gray-400 underline" onClick={() => setShowLoanPanel(false)}>取消</button>
            </div>
          ) : (
            <button
              className="btn-secondary w-full text-sm"
              onClick={() => setShowLoanPanel(true)}
            >
              🏦 申請應急借款
            </button>
          )}
        </div>
      )}

      {/* ── 信用 / 職業資訊 ───────────── */}
      <div className="card">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">目前年齡</span>
          <span className="text-white font-bold">{currentAge.toFixed(1)} 歲</span>
        </div>
        <div className="flex justify-between text-sm mt-1">
          <span className="text-gray-400">信用評分</span>
          <span className={player.creditScore >= 650 ? 'text-green-400' : player.creditScore >= 550 ? 'text-yellow-400' : 'text-red-400'}>
            {player.creditScore}
          </span>
        </div>
        <div className="flex justify-between text-sm mt-1">
          <span className="text-gray-400">職業</span>
          <span className="text-white">{player.profession.name} ({player.quadrant})</span>
        </div>
      </div>

      {/* ── 決策分析 ──────────────────── */}
      <button className="btn-primary w-full" onClick={onRequestAnalysis}>
        📊 {isGameOver ? '查看人生分析報告' : '查看目前決策歷程'}
      </button>
    </div>
  );
}
