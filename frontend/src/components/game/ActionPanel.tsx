import { useState } from 'react';
import type { Player } from '../../types/game';
import EffectPreview from './EffectPreview';
import type { MoneyDetailMode } from './MoneyDetailSheet';

const DESTINATIONS = [
  { id: 'taiwan_cycling',   name: '台灣環島',   tier: 'inner', cost: 15_000,  lifeExp: 8,  region: '亞太', desc: '騎單車環島',            special: '' },
  { id: 'japan_tokyo',      name: '日本東京',   tier: 'inner', cost: 38_000,  lifeExp: 12, region: '亞太', desc: 'NT+1',                   special: '人脈+1' },
  { id: 'thailand_bangkok', name: '泰國曼谷',   tier: 'inner', cost: 22_000,  lifeExp: 10, region: '亞太', desc: '東南亞文化',              special: '' },
  { id: 'korea_seoul',      name: '韓國首爾',   tier: 'inner', cost: 30_000,  lifeExp: 10, region: '亞太', desc: '韓流體驗',               special: '' },
  { id: 'malaysia_kl',      name: '馬來西亞',   tier: 'inner', cost: 22_000,  lifeExp: 9,  region: '亞太', desc: '美食天堂',               special: '' },
  { id: 'hong_kong',        name: '香港',       tier: 'inner', cost: 18_000,  lifeExp: 8,  region: '亞太', desc: 'FQ+1',                   special: '財商+1' },
  { id: 'vietnam_hanoi',    name: '越南河內',   tier: 'inner', cost: 15_000,  lifeExp: 8,  region: '亞太', desc: '歷史古城',               special: '' },
  { id: 'bali',             name: '峇里島',     tier: 'inner', cost: 30_000,  lifeExp: 11, region: '亞太', desc: 'HP+5 療癒之旅',          special: 'HP+5' },
  { id: 'singapore',        name: '新加坡',     tier: 'inner', cost: 38_000,  lifeExp: 10, region: '亞太', desc: 'FQ+1',                   special: '財商+1' },
  { id: 'australia_sydney', name: '澳洲雪梨',   tier: 'inner', cost: 60_000,  lifeExp: 14, region: '亞太', desc: '南半球大都市',            special: '' },
  { id: 'france_paris',     name: '法國巴黎',   tier: 'outer', cost: 120_000, lifeExp: 20, region: '歐洲', desc: 'NT+2',                   special: '人脈+2' },
  { id: 'usa_newyork',      name: '美國紐約',   tier: 'outer', cost: 135_000, lifeExp: 20, region: '北美', desc: 'FQ+2 金融洞察',          special: '財商+2' },
  { id: 'africa_safari',    name: '非洲獵遊',   tier: 'outer', cost: 225_000, lifeExp: 30, region: '非洲', desc: 'SK+1 視野拓展',          special: '技能+1' },
  { id: 'antarctica',       name: '南極探險',   tier: 'outer', cost: 450_000, lifeExp: 50, region: '極地', desc: '傳承分+10（稀有）',      special: '傳承+10' },
  { id: 'italy_culture',    name: '義大利文化', tier: 'outer', cost: 150_000, lifeExp: 22, region: '歐洲', desc: 'NT+2',                   special: '人脈+2' },
  { id: 'uae_dubai',        name: '中東杜拜',   tier: 'outer', cost: 180_000, lifeExp: 22, region: '中東', desc: 'FQ+1',                   special: '財商+1' },
  { id: 'peru_machu',       name: '南美洲秘魯', tier: 'outer', cost: 180_000, lifeExp: 25, region: '南美', desc: '印加古文明',              special: '' },
  { id: 'world_cruise',     name: '環遊世界',   tier: 'outer', cost: 750_000, lifeExp: 80, region: '全球', desc: '全屬性+1（人生夢想）',   special: '全屬性+1' },
  { id: 'japan_fuji',       name: '富士山朝聖', tier: 'outer', cost: 75_000,  lifeExp: 18, region: '亞太', desc: 'HP+10 精神修復',         special: 'HP+10' },
  { id: 'silicon_valley',   name: '矽谷考察',   tier: 'outer', cost: 150_000, lifeExp: 20, region: '北美', desc: 'FQ+3，可觸發創業事件',  special: '財商+3' },
] as const;

const INSURANCE_COSTS: Record<'medical' | 'life' | 'property', number> = {
  medical: 6_000,
  life: 3_000,
  property: 9_000,
};
const INSURANCE_LABELS: Record<'medical' | 'life' | 'property', string> = {
  medical: '🏥 醫療險',
  life: '🛡 壽險',
  property: '🏠 財產險',
};

const LEVERAGE_RATE_MULTIPLIER = 1.25;
const DCA_AMOUNTS = [15_000, 30_000, 75_000, 150_000, 300_000, 750_000] as const;
const LOAN_AMOUNTS = [75_000, 150_000, 300_000, 450_000, 750_000] as const;

function getLoanLimit(score: number): number {
  if (score >= 750) return 1_200_000;
  if (score >= 650) return 750_000;
  if (score >= 550) return 450_000;
  if (score >= 300) return 150_000;
  return 75_000;
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
  otherPlayers: { id: string; name: string }[];
  onTravel: (destinationId: string) => void;
  onSocialEvent: () => void;
  onBuyInsurance: (type: 'medical' | 'life' | 'property') => void;
  onCancelInsurance?: (type: 'medical' | 'life' | 'property') => void;
  onRepayLoan?: (liabilityId: string, amount: number) => void;
  onTakeEmergencyLoan: (amount: number) => void;
  onTakeLeverageLoan: (amount: number, targetAssetName: string) => void;
  onInvestStockDCA: (amount: number) => void;
  onLoanOffer: (targetId: string, amount: number, monthlyRate: number) => void;
  onLoanRequest: (targetId: string, amount: number, monthlyRate: number) => void;
  onSellAsset: (assetId: string) => void;
  onBuyHome?: (optionId: string) => void;
  onShowDetail?: (mode: MoneyDetailMode) => void;
  onRequestAnalysis: () => void;
  isGameOver: boolean;
  careerChangeData?: {
    message: string;
    availableProfessions: {
      id: string;
      name: string;
      salary?: number;
      quadrant?: string;
      description?: string;
      assetCost?: number;
      canAfford?: boolean;
      startingFQ?: number;
    }[];
  } | null;
  onCareerChange?: (professionId: string) => void;
}

export default function ActionPanel({
  player,
  currentAge,
  otherPlayers,
  onTravel,
  onSocialEvent,
  onBuyInsurance,
  onCancelInsurance,
  onRepayLoan,
  onTakeEmergencyLoan,
  onTakeLeverageLoan,
  onInvestStockDCA,
  onLoanOffer,
  onLoanRequest,
  onSellAsset,
  onBuyHome,
  onShowDetail,
  onRequestAnalysis,
  isGameOver,
  careerChangeData,
  onCareerChange,
}: Props) {
  const [showTravelPanel, setShowTravelPanel] = useState(false);
  const [insuranceConfirm, setInsuranceConfirm] = useState<'medical' | 'life' | 'property' | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState<'medical' | 'life' | 'property' | null>(null);
  const [repayTarget, setRepayTarget] = useState<string | null>(null);
  const [showLoanPanel, setShowLoanPanel] = useState(false);
  const [showLeveragePanel, setShowLeveragePanel] = useState(false);
  const [leverageAssetName, setLeverageAssetName] = useState('');
  const [showDCAPanel, setShowDCAPanel] = useState(false);
  const [showP2PPanel, setShowP2PPanel] = useState(false);
  const [homeConfirmId, setHomeConfirmId] = useState<string | null>(null);
  const [showHomePanel, setShowHomePanel] = useState(false);
  const [p2pMode, setP2pMode] = useState<'lend' | 'borrow'>('lend');
  const [p2pTarget, setP2pTarget] = useState('');
  const [p2pAmount, setP2pAmount] = useState(75_000);
  const [p2pRate, setP2pRate] = useState(0.01);
  const [sellConfirmId, setSellConfirmId] = useState<string | null>(null);
  // 點選任何行動先顯示「效果與價值」，確認後才執行
  const [travelPreview, setTravelPreview] = useState<string | null>(null);
  const [socialPreview, setSocialPreview] = useState(false);
  const [repayPreview, setRepayPreview] = useState<{ loanId: string; amount: number } | null>(null);
  const [dcaPreview, setDcaPreview] = useState<number | null>(null);
  const [loanPreview, setLoanPreview] = useState<number | null>(null);
  const [leveragePreview, setLeveragePreview] = useState<number | null>(null);
  const [careerPreview, setCareerPreview] = useState<string | null>(null);
  const info = player.actionInfo;
  const tokenNote = player.hasFlexibleSchedule ? '自由行程職業不限次數' : '消耗本輪 1 次活動額度（固定班表每輪 1 次）';

  const noTokensLeft = !player.hasFlexibleSchedule && player.actionTokensThisPayday <= 0;
  const scheduleLabel = player.hasFlexibleSchedule
    ? '自由行程（不限次數）'
    : `本輪剩餘活動：${player.actionTokensThisPayday} 次`;

  const travelDisabled = player.isBedridden || player.stats.health < 50 || noTokensLeft;
  const socialDisabled = player.isBedridden || player.isMarried || noTokensLeft;
  const tokenReason = '本輪的活動額度已用完（固定班表每輪 1 次，下一輪開始時重置）';
  const travelReason = player.isBedridden ? '臥床中無法出遊'
    : player.stats.health < 50 ? `健康值 ${player.stats.health} 未達 50，先投資健康`
    : noTokensLeft ? tokenReason : '';
  const socialReason = player.isBedridden ? '臥床中無法參加'
    : player.isMarried ? '已婚，不再參加聯誼'
    : noTokensLeft ? tokenReason : '';

  const availableDestinations = info?.travel
    ? info.travel.map((t) => ({ id: t.id, name: t.name, tier: t.tier, cost: t.cost, lifeExp: t.lifeExp, region: t.region, desc: t.description, special: [t.statEffect?.nt ? `人脈+${t.statEffect.nt}` : '', t.statEffect?.fq ? `財商+${t.statEffect.fq}` : '', t.statEffect?.sk ? `專長+${t.statEffect.sk}` : '', t.statEffect?.hp ? `HP+${t.statEffect.hp}` : '', t.statEffect?.legacyScore ? `傳承+${t.statEffect.legacyScore}` : ''].filter(Boolean).join(' ') }))
    : DESTINATIONS.filter((d) => d.tier === 'inner' || (d.tier === 'outer' && player.isInFastTrack)).map((d) => ({ ...d, desc: d.desc as string, special: d.special as string }));
  const visited = new Set(player.visitedDestinations ?? []);

  const loanLimit = getLoanLimit(player.creditScore);
  const loanRate = getLoanRate(player.creditScore);
  // 只計算「無擔保負債」（不含房貸、加盟貸款等資產綁定的 secured debt）
  const securedLiabilityIds = new Set(
    (player.assets ?? [])
      .map((a) => a.linkedLiabilityId)
      .filter((id): id is string => Boolean(id))
  );
  // 與伺服器 getUnsecuredLiabilityTotal 同規則：學貸不占信用額度
  const existingLoanTotal = (player.liabilities ?? [])
    .filter((l) => !securedLiabilityIds.has(l.id) && !l.id.startsWith('edu-loan-'))
    .reduce((s, l) => s + l.totalDebt, 0);
  // 可主動提前還款的負債：應急、槓桿、玩家借貸、學貸（資產綁定的房貸等由賣出資產時清償）
  const repayableLoans = (player.liabilities ?? []).filter((l) =>
    (!securedLiabilityIds.has(l.id) || l.id.startsWith('home-loan-') || l.id.startsWith('car-loan-')) && l.totalDebt > 0);
  const availableLoan = Math.max(0, loanLimit - existingLoanTotal);

  const dcaPortfolioValue = player.assets?.find((a) => a.id === 'stock-dca')?.currentValue ?? 0;

  return (
    <div className="senior-action-panel space-y-3">
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
              {travelPreview && (() => {
                const t = info?.travel.find((x) => x.id === travelPreview);
                const d = availableDestinations.find((x) => x.id === travelPreview);
                if (!d) return null;
                const fx = t?.statEffect ?? {};
                const rows = [
                  { label: '費用', value: `-$${fmt(d.cost)}`, tone: 'bad' as const },
                  { label: '生命體驗', value: `+${t?.lifeExp ?? d.lifeExp}${t?.visited ? '（去過減半）' : ''}`, tone: 'good' as const },
                  ...(t?.hpCost ? [{ label: '旅途消耗 HP', value: `-${t.hpCost}`, tone: 'bad' as const }] : []),
                  ...(fx.hp ? [{ label: '療癒 HP', value: `+${fx.hp}`, tone: 'good' as const }] : []),
                  ...(fx.nt ? [{ label: '人脈 NT', value: `+${fx.nt}`, tone: 'good' as const }] : []),
                  ...(fx.fq ? [{ label: '財商 FQ', value: `+${fx.fq}`, tone: 'good' as const }] : []),
                  ...(fx.sk ? [{ label: '第二專長 SK', value: `+${fx.sk}`, tone: 'good' as const }] : []),
                  ...(fx.legacyScore ? [{ label: '傳承加分', value: `+${fx.legacyScore}`, tone: 'good' as const }] : []),
                  ...(t && t.salaryPenalty < 1 ? [{ label: '下次發薪薪水', value: `×${t.salaryPenalty}`, tone: 'bad' as const }] : []),
                  { label: '剩餘現金', value: `$${fmt(player.cash - d.cost)}`, tone: 'neutral' as const },
                ];
                return <EffectPreview title={`✈️ ${d.name}：效果與價值`} rows={rows} notes={[tokenNote, '體驗值提高人生評分並計入人生指標「體驗」（≥ 45）', d.desc]}
                  confirmLabel="確認出發" onCancel={() => setTravelPreview(null)} disabled={player.cash < d.cost} disabledReason="現金不足"
                  onConfirm={() => { onTravel(d.id); setTravelPreview(null); setShowTravelPanel(false); }} />;
              })()}
              <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                {availableDestinations.map((d) => {
                  const alreadyVisited = visited.has(d.id);
                  const canAfford = player.cash >= d.cost;
                  return (
                    <button
                      key={d.id}
                      disabled={!canAfford || travelDisabled}
                      onClick={() => setTravelPreview(d.id)}
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
          ) : socialPreview && info ? (
            <EffectPreview title="💑 參加聯誼：效果與價值" rows={[
              { label: '費用', value: `-$${fmt(info.social.cost)}`, tone: 'bad' },
              { label: '深度關係 DRS', value: `+${info.social.drsMin}～${info.social.drsMax}${info.social.inPeak ? '（黃金期）' : ''}`, tone: 'good' },
              { label: '目前 DRS', value: `${info.social.currentDrs}／${info.social.threshold} 可提親`, tone: 'neutral' },
              { label: '剩餘現金', value: `$${fmt(player.cash - info.social.cost)}`, tone: 'neutral' },
            ]} notes={[tokenNote, info.social.active ? '關係路徑已啟動，累積到門檻後由主持人開啟婚姻舞台' : '第一次聯誼會啟動關係路徑', `婚姻黃金期 ${info.social.peakStart}–${info.social.peakEnd} 歲加成較高；DRS ≥ 50 完成人生指標「關係」`, '結婚後有配偶收入與婚姻加成']}
              confirmLabel="確認參加" onCancel={() => setSocialPreview(false)} disabled={player.cash < info.social.cost} disabledReason="現金不足"
              onConfirm={() => { onSocialEvent(); setSocialPreview(false); }} />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <button
                  className="btn-secondary text-sm w-full"
                  disabled={travelDisabled}
                  onClick={() => setShowTravelPanel(true)}
                  title={travelReason || '選擇目的地出遊'}
                >
                  ✈️ 出國旅遊
                </button>
                {travelReason && <p className="text-[11px] leading-snug text-orange-300">{travelReason}</p>}
              </div>
              <div className="space-y-1">
                <button
                  className="btn-secondary text-sm w-full"
                  disabled={socialDisabled}
                  onClick={() => (info ? setSocialPreview(true) : onSocialEvent())}
                  title={socialReason || '累積深度關係值'}
                >
                  💑 參加聯誼
                </button>
                {socialReason && <p className="text-[11px] leading-snug text-orange-300">{socialReason}</p>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 住房：租屋 vs 買房 ───────────── */}
      {!isGameOver && onBuyHome && (
        <div className="card">
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs text-gray-400">住房</p>
            <span className={`text-xs px-2 py-0.5 rounded-full ${player.housing === 'own' ? 'bg-emerald-900 text-emerald-300' : 'bg-gray-700 text-gray-300'}`}>
              {player.housing === 'own' ? `🏠 自有（房貸 $${fmt(player.expenses.homeMortgagePayment)}/月）` : `🔑 租屋 $${fmt(player.expenses.rent ?? 0)}/月`}
            </span>
          </div>
          {player.housing === 'own' ? (
            <p className="text-sm text-gray-300">房子在「持有資產」清單可以出售（市價 − 剩餘房貸 − 3% 稅費），賣掉後回到租屋。房貸可用「提前還款」降低月付。</p>
          ) : !showHomePanel ? (
            <button className="btn-secondary w-full text-sm" onClick={() => setShowHomePanel(true)}>🏠 看看買房選項（頭期款 20%、30 年房貸年利 2.4%）</button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-300">房租會隨物價上漲；買房後不付房租，房價隨房市漲跌，出售免資本利得稅。</p>
                <button className="text-xs text-gray-400 underline shrink-0" onClick={() => { setShowHomePanel(false); setHomeConfirmId(null); }}>收起</button>
              </div>
              {(player.homeOffers ?? []).map((o) => (
                <div key={o.id} className={`rounded-xl border p-3 ${o.affordable ? 'border-gray-600 bg-gray-800' : 'border-gray-700 bg-gray-800/60'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-white">{o.name}</span>
                    <span className="text-sm text-gray-200">${fmt(o.price)}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-300">頭期款 ${fmt(o.downPayment)} ＋ 稅費 ${fmt(o.transactionCost)}；房貸 ${fmt(o.loan)}，每月 ${fmt(o.monthlyPayment)}
                    <span className={o.monthlyDelta >= 0 ? ' text-emerald-300' : ' text-amber-300'}>（比房租{o.monthlyDelta >= 0 ? '省' : '多'} ${fmt(Math.abs(o.monthlyDelta))}/月）</span></p>
                  {!o.affordable && <p className="mt-1 text-xs text-red-300">✗ {o.reason}</p>}
                  {o.affordable && homeConfirmId !== o.id && (
                    <button className="btn-primary mt-2 w-full text-sm" onClick={() => setHomeConfirmId(o.id)}>買下 {o.name}</button>
                  )}
                  {homeConfirmId === o.id && (
                    <div className="mt-2">
                      <EffectPreview title={`🏠 買下${o.name}：效果與價值`} rows={[
                        { label: '現金支付（頭期款＋稅費）', value: `-$${fmt(o.cashNeeded)}`, tone: 'bad' },
                        { label: '新增資產（房價）', value: `+$${fmt(o.price)}`, tone: 'good' },
                        { label: '新增房貸', value: `-$${fmt(o.loan)}`, tone: 'bad' },
                        { label: '淨資產變化', value: `-$${fmt(o.transactionCost)}（稅費）`, tone: 'neutral' },
                        { label: '每月房租', value: `-$${fmt(player.expenses.rent ?? 0)} → $0`, tone: 'good' },
                        { label: '每月房貸', value: `$0 → -$${fmt(o.monthlyPayment)}`, tone: 'bad' },
                        { label: '月現金流變化', value: `${o.monthlyDelta >= 0 ? '+' : '-'}$${fmt(Math.abs(o.monthlyDelta))}`, tone: o.monthlyDelta >= 0 ? 'good' : 'bad' },
                        { label: '剩餘現金', value: `$${fmt(player.cash - o.cashNeeded)}`, tone: 'neutral' },
                      ]} notes={['房租之後會隨物價每輪 +3%，房貸固定 30 年', '房價隨房地產行情卡漲跌，算淨資產但不算被動收入', '房貸可提前還款降低月付；賣房時扣剩餘房貸與 3% 稅費，免資本利得稅']}
                        confirmLabel={`確認付 $${fmt(o.cashNeeded)}`} onCancel={() => setHomeConfirmId(null)}
                        onConfirm={() => { onBuyHome(o.id); setHomeConfirmId(null); setShowHomePanel(false); }} />
                    </div>
                  )}
                </div>
              ))}
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
              <p className="text-sm text-white font-semibold">確認購買 {INSURANCE_LABELS[insuranceConfirm]}：效果與價值</p>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">啟動費</span>
                <span className="text-red-400 font-bold">-${fmt(INSURANCE_COSTS[insuranceConfirm])}</span>
              </div>
              {info && (() => { const ins = info.insurance[insuranceConfirm]; return (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">每月保費（現在年齡）</span>
                    <span className="text-red-300">-${fmt(ins.monthlyPremium)}{info.premiumMultiplier !== 1 ? ` （×${info.premiumMultiplier}）` : ''}</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-gray-400">抵免的危機</span>
                    <ul className="mt-0.5 space-y-0.5">
                      {ins.covers.map((c) => <li key={c.title} className="flex justify-between text-xs"><span className="text-gray-200">{c.title}{c.canCauseDeath ? '（可致死）' : ''}</span><span className="text-emerald-300">${fmt(c.baseCost)} → ${fmt(c.insuredCost)}</span></li>)}
                    </ul>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">年度節稅扣除</span>
                    <span className="text-emerald-300">${fmt(ins.deduction)}</span>
                  </div>
                  {ins.extra && <p className="text-[11px] text-gray-400">• {ins.extra}</p>}
                  <p className="text-[11px] text-gray-400">• 保費會隨年齡上升（成家 ×1.3、轉型 ×1.7、退休 ×2.2、傳承 ×3）；可隨時退保</p>
                </>
              ); })()}
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
                    className={`text-xs py-2 rounded-lg transition-colors ${owned ? 'bg-teal-800 text-teal-200 hover:bg-teal-700' : 'btn-secondary'}`}
                    onClick={() => { if (owned) setCancelConfirm(type); else setInsuranceConfirm(type); }}
                  >
                    {INSURANCE_LABELS[type]}<br />
                    <span className={owned ? 'text-teal-300' : 'text-gray-400'}>
                      {owned ? '已投保（點此退保）' : `$${fmt(INSURANCE_COSTS[type])}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {cancelConfirm && onCancelInsurance && (
        <div className="card space-y-2 border border-red-800">
          <p className="text-sm font-bold text-red-200">確認退保 {INSURANCE_LABELS[cancelConfirm]}？</p>
          <p className="text-xs text-gray-400">退保後立即停止扣保費，但之後遇到對應危機要自己付全額；已繳的啟動費不退。</p>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-secondary text-sm" onClick={() => setCancelConfirm(null)}>保留保險</button>
            <button className="text-sm rounded-xl bg-red-800 text-white py-2 font-bold" onClick={() => { onCancelInsurance(cancelConfirm); setCancelConfirm(null); }}>確認退保</button>
          </div>
        </div>
      )}

      {/* ── 提前還款 ──────────────── */}
      {!isGameOver && onRepayLoan && repayableLoans.length > 0 && (
        <div className="card">
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs text-gray-400">提前還款</p>
            <span className="text-xs text-gray-500">手頭現金 ${fmt(player.cash)}</span>
          </div>
          <div className="space-y-2">
            {repayableLoans.map((loan) => {
              const isOpen = repayTarget === loan.id;
              const maxPay = Math.max(0, Math.min(player.cash, loan.totalDebt));
              const options = [0.25, 0.5, 1].map((share) => Math.min(maxPay, Math.round(loan.totalDebt * share))).filter((v, i, arr) => v > 0 && arr.indexOf(v) === i);
              return (
                <div key={loan.id} className="rounded-lg border border-gray-700 bg-gray-900/60 p-2">
                  <div className="flex justify-between items-center text-sm">
                    <div>
                      <p className="font-semibold text-white">{loan.name}</p>
                      <p className="text-[11px] text-gray-400">餘額 ${fmt(loan.totalDebt)} · 月付 ${fmt(loan.monthlyPayment)}</p>
                    </div>
                    <button className="text-xs btn-secondary px-2 py-1" disabled={maxPay <= 0} onClick={() => setRepayTarget(isOpen ? null : loan.id)}>
                      {maxPay <= 0 ? '現金不足' : isOpen ? '收起' : '還款'}
                    </button>
                  </div>
                  {isOpen && repayPreview?.loanId === loan.id && (() => {
                    const amt = repayPreview.amount; const share = Math.min(1, amt / loan.totalDebt); const clear = amt >= loan.totalDebt;
                    const newMonthly = clear ? 0 : Math.round(loan.monthlyPayment * (1 - share));
                    const credit = Math.floor((info?.loan.repayCredit ?? 15) * share) + (clear ? (info?.loan.clearCredit ?? 25) : 0);
                    return (
                      <div className="mt-2">
                        <EffectPreview title={`還款 ${loan.name}：效果與價值`} rows={[
                          { label: '還款金額', value: `-$${fmt(amt)}`, tone: 'bad' },
                          { label: '餘額', value: `$${fmt(loan.totalDebt)} → $${fmt(loan.totalDebt - amt)}`, tone: 'good' },
                          { label: '每月月付', value: `$${fmt(loan.monthlyPayment)} → $${fmt(newMonthly)}`, tone: 'good' },
                          { label: '月現金流', value: `+$${fmt(loan.monthlyPayment - newMonthly)}/月`, tone: 'good' },
                          { label: '信用分', value: `+${credit}${clear ? '（含還清加分）' : ''}`, tone: 'good' },
                          { label: '剩餘現金', value: `$${fmt(player.cash - amt)}`, tone: 'neutral' },
                        ]} notes={[loan.id.startsWith('home-loan-') || loan.id.startsWith('car-loan-') ? '房貸車貸還本金會等比例降低月付' : '應急／槓桿借款的月付是利息，本金不會自己減少', '還清整筆負債另 +5 生命體驗']}
                          confirmLabel="確認還款" onCancel={() => setRepayPreview(null)}
                          onConfirm={() => { onRepayLoan(loan.id, amt); setRepayPreview(null); setRepayTarget(null); }} />
                      </div>
                    );
                  })()}
                  {isOpen && repayPreview?.loanId !== loan.id && (
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {options.map((amt) => (
                        <button
                          key={amt}
                          className="rounded-lg py-2 text-xs border border-emerald-800 bg-emerald-950 text-emerald-200 hover:bg-emerald-900"
                          onClick={() => setRepayPreview({ loanId: loan.id, amount: amt })}
                        >
                          還 ${fmt(amt)}{amt >= loan.totalDebt ? '（還清）' : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-gray-500">還款會依還款佔債務比例加信用分；還清另有加分。房貸、車貸還本金會等比例降低月付。</p>
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

          {showDCAPanel && dcaPreview !== null ? (() => {
            const r = info?.dca.monthlyReturnRate ?? 0.006; const dv = info?.dca.monthlyDividendRate ?? 0.003; const amt = dcaPreview;
            return <EffectPreview title={`📈 投入 $${fmt(amt)}：效果與價值`} rows={[
              { label: '投入', value: `-$${fmt(amt)}`, tone: 'bad' },
              { label: '每月現金股息', value: `+$${fmt(Math.round(amt * dv))}/月（被動收入）`, tone: 'good' },
              { label: '每月市值增值', value: `約 +$${fmt(Math.round(amt * r))}（${(r * 100).toFixed(1)}%）`, tone: 'good' },
              { label: '24 個月後市值', value: `約 $${fmt(Math.round(amt * Math.pow(1 + r, 24)))}`, tone: 'good' },
              { label: '年化報酬', value: `約 ${info?.dca.annualized ?? 11}%`, tone: 'neutral' },
              { label: '持倉後合計', value: `$${fmt(Math.round(dcaPortfolioValue + amt))}`, tone: 'neutral' },
              { label: '剩餘現金', value: `$${fmt(player.cash - amt)}`, tone: 'neutral' },
            ]} notes={['股息乘上財商乘數，幫助脫離內圈', '市值受股市行情卡與世界事件影響，可能腰斬也可能翻倍', '賣出時獲利課 20% 資本利得稅']}
              confirmLabel="確認投入" onCancel={() => setDcaPreview(null)} disabled={player.cash < amt} disabledReason="現金不足"
              onConfirm={() => { onInvestStockDCA(amt); setDcaPreview(null); setShowDCAPanel(false); }} />;
          })() : showDCAPanel ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-400">選擇每次投入金額（指數基金，每月增值 {((info?.dca.monthlyReturnRate ?? 0.006) * 100).toFixed(1)}%、股息 {((info?.dca.monthlyDividendRate ?? 0.003) * 100).toFixed(1)}%，年化約 {info?.dca.annualized ?? 11}%）</p>
              <div className="grid grid-cols-3 gap-2">
                {DCA_AMOUNTS.map((amt) => {
                  const canAfford = player.cash >= amt;
                  return (
                    <button
                      key={amt}
                      disabled={!canAfford}
                      onClick={() => setDcaPreview(amt)}
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

          {showLoanPanel && loanPreview !== null ? (() => {
            const amt = loanPreview; const monthly = Math.round(amt * loanRate); const penalty = info?.loan.emergencyCreditPenalty ?? -50;
            return <EffectPreview title={`🏦 應急借款 $${fmt(amt)}：效果與價值`} rows={[
              { label: '拿到現金', value: `+$${fmt(amt)}`, tone: 'good' },
              { label: '每月利息', value: `-$${fmt(monthly)}/月（${(loanRate * 100).toFixed(1)}%）`, tone: 'bad' },
              { label: '信用分', value: `${player.creditScore} → ${Math.max(300, player.creditScore + penalty)}`, tone: 'bad' },
              { label: '剩餘信用額度', value: `$${fmt(availableLoan - amt)}`, tone: 'neutral' },
              { label: '現金', value: `$${fmt(player.cash + amt)}`, tone: 'neutral' },
            ]} notes={['本金不會自動攤還，要用「提前還款」還；還款會加回信用分', '信用分下降會讓之後借款利率變高、上限變低', '危機自救時也可以用這個補足費用']}
              confirmLabel="確認借款" onCancel={() => setLoanPreview(null)}
              onConfirm={() => { onTakeEmergencyLoan(amt); setLoanPreview(null); setShowLoanPanel(false); }} />;
          })() : showLoanPanel ? (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>可借：${fmt(availableLoan)}</span>
                <span title="不含房貸與事業貸款等已用資產做擔保的負債">無擔保負債：${fmt(existingLoanTotal)}</span>
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
                        onClick={() => setLoanPreview(amt)}
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

      {/* ── 投資槓桿借款（利率較高、不扣信用，僅限購買投資資產） ──── */}
      {!isGameOver && (
        <div className="card">
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs text-gray-400">投資槓桿借款</p>
            <span className="text-xs text-gray-500">
              利率 {(loanRate * LEVERAGE_RATE_MULTIPLIER * 100).toFixed(2)}%/月（不扣信用，比應急借款貴）
            </span>
          </div>

          {showLeveragePanel && leveragePreview !== null ? (() => {
            const amt = leveragePreview; const rate = loanRate * LEVERAGE_RATE_MULTIPLIER; const monthly = Math.max(1, Math.round(amt * rate));
            return <EffectPreview title={`🚀 槓桿借款 $${fmt(amt)}：效果與價值`} rows={[
              { label: '拿到現金', value: `+$${fmt(amt)}`, tone: 'good' },
              { label: '每月利息', value: `-$${fmt(monthly)}/月（${(rate * 100).toFixed(2)}%）`, tone: 'bad' },
              { label: '信用分', value: '不變', tone: 'neutral' },
              { label: '剩餘信用額度', value: `$${fmt(availableLoan - amt)}`, tone: 'neutral' },
              { label: '現金', value: `$${fmt(player.cash + amt)}`, tone: 'neutral' },
            ]} notes={[`用途：${leverageAssetName.trim() || '投資資產'}`, '利率比應急借款高 25%，但不扣信用分', '划算的標準：買到的資產月現金流要高於每月利息', '本金要用「提前還款」主動還']}
              confirmLabel="確認借款" onCancel={() => setLeveragePreview(null)}
              onConfirm={() => { onTakeLeverageLoan(amt, leverageAssetName.trim() || '投資資產'); setLeveragePreview(null); setShowLeveragePanel(false); setLeverageAssetName(''); }} />;
          })() : showLeveragePanel ? (
            <div className="space-y-2">
              <p className="text-[11px] text-gray-400">
                專為投資資產設計：不扣信用值，但利率比應急借款高 25%。請輸入打算購買的資產名稱備註。
              </p>
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>可借：${fmt(availableLoan)}</span>
                <span title="不含房貸與事業貸款等已用資產做擔保的負債">無擔保負債：${fmt(existingLoanTotal)}</span>
              </div>
              <input
                type="text"
                value={leverageAssetName}
                onChange={(e) => setLeverageAssetName(e.target.value)}
                placeholder="目標資產名稱（例：3房公寓）"
                className="w-full rounded-lg bg-gray-700 border border-gray-600 text-white text-sm px-2 py-1.5"
                maxLength={30}
              />
              {availableLoan <= 0 ? (
                <p className="text-xs text-red-400 text-center py-2">已達借款上限，無法再借</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {LOAN_AMOUNTS.filter((a) => a <= availableLoan).map((amt) => {
                    const monthly = Math.max(1, Math.round(amt * loanRate * LEVERAGE_RATE_MULTIPLIER));
                    const disabled = !leverageAssetName.trim();
                    return (
                      <button
                        key={amt}
                        disabled={disabled}
                        onClick={() => setLeveragePreview(amt)}
                        className={`rounded-lg py-2 px-3 text-left text-sm border transition-colors ${
                          disabled
                            ? 'bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed'
                            : 'bg-emerald-950 border-emerald-800 text-emerald-200 hover:bg-emerald-900'
                        }`}
                      >
                        <div className="font-semibold">${fmt(amt)}</div>
                        <div className="text-[10px] text-emerald-400">月付 ${fmt(monthly)}</div>
                        <div className="text-[10px] text-gray-400">剩 ${fmt(player.cash + amt)}</div>
                      </button>
                    );
                  })}
                </div>
              )}
              <button className="text-xs text-gray-400 underline" onClick={() => { setShowLeveragePanel(false); setLeverageAssetName(''); }}>取消</button>
            </div>
          ) : (
            <button
              className="w-full rounded-xl py-2 text-sm bg-emerald-700 hover:bg-emerald-600 text-white font-semibold"
              onClick={() => setShowLeveragePanel(true)}
            >
              🚀 投資槓桿借款
            </button>
          )}
        </div>
      )}

      {/* ── 信用 / 職業資訊 ───────────── */}
      <div className="card">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">目前年齡</span>
          <span className="text-white font-bold">{Math.round(currentAge)} 歲</span>
        </div>
        <div className="flex justify-between text-sm mt-1">
          <button type="button" className="text-gray-400 underline decoration-dotted" onClick={() => onShowDetail?.('credit')}>信用評分（點我看怎麼算）</button>
          <span className={player.creditScore >= 650 ? 'text-green-400' : player.creditScore >= 550 ? 'text-yellow-400' : 'text-red-400'}>
            {player.creditScore}
          </span>
        </div>
        <div className="flex justify-between text-sm mt-1">
          <span className="text-gray-400">職業</span>
          <span className="text-white">{player.profession.name} ({player.quadrant})</span>
        </div>
      </div>

      {/* ── P2P 借貸 ─────────────────────── */}
      {!isGameOver && (
        <div className="card">
          <p className="text-xs text-gray-400 mb-2">P2P 玩家借貸</p>
          {otherPlayers.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-2">需要其他參與者才能使用<br />P2P 借貸功能</p>
          ) : showP2PPanel ? (
            <div className="space-y-2">
              {/* 模式切換 */}
              <div className="grid grid-cols-2 gap-1 bg-gray-900 rounded-lg p-1">
                <button
                  className={`text-xs py-1.5 rounded ${p2pMode === 'lend' ? 'bg-emerald-700 text-white font-bold' : 'text-gray-400'}`}
                  onClick={() => setP2pMode('lend')}
                >🤝 借出（提供借款）</button>
                <button
                  className={`text-xs py-1.5 rounded ${p2pMode === 'borrow' ? 'bg-amber-700 text-white font-bold' : 'text-gray-400'}`}
                  onClick={() => setP2pMode('borrow')}
                >💸 借入（請求借款）</button>
              </div>
              <p className="text-xs text-gray-400">
                {p2pMode === 'lend'
                  ? '提供借款給其他玩家：你拿出現金，對方需以月息還款給你。'
                  : '主動向其他玩家請求借款：對方拿出現金借給你，你每月以月息還款。會占用你的信用額度。'}
              </p>
              <select
                className="w-full rounded-lg bg-gray-700 border border-gray-600 text-white text-sm px-2 py-1.5"
                value={p2pTarget}
                onChange={(e) => setP2pTarget(e.target.value)}
              >
                <option value="">-- {p2pMode === 'lend' ? '選擇借款人' : '選擇貸款人'} --</option>
                {otherPlayers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <div className="flex gap-2 items-center">
                <span className="text-xs text-gray-400 shrink-0">金額</span>
                <select
                  className="flex-1 rounded-lg bg-gray-700 border border-gray-600 text-white text-sm px-2 py-1.5"
                  value={p2pAmount}
                  onChange={(e) => setP2pAmount(Number(e.target.value))}
                >
                  {[15_000, 30_000, 75_000, 150_000, 300_000, 750_000].map((a) => (
                    <option key={a} value={a}>${fmt(a)}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 items-center">
                <span className="text-xs text-gray-400 shrink-0">月利率</span>
                <select
                  className="flex-1 rounded-lg bg-gray-700 border border-gray-600 text-white text-sm px-2 py-1.5"
                  value={p2pRate}
                  onChange={(e) => setP2pRate(Number(e.target.value))}
                >
                  {[0.005, 0.01, 0.015, 0.02].map((r) => (
                    <option key={r} value={r}>{(r * 100).toFixed(1)}%</option>
                  ))}
                </select>
              </div>
              {p2pTarget && p2pMode === 'lend' && (
                <div className="text-xs text-gray-400">
                  對方月還款：<span className="text-yellow-300">${fmt(Math.round(p2pAmount * p2pRate))}</span>
                  {'  '}你付出：<span className={player.cash >= p2pAmount ? 'text-emerald-400' : 'text-red-400'}>${fmt(p2pAmount)}</span>
                  {player.cash < p2pAmount && <span className="text-red-400 ml-1">（現金不足）</span>}
                </div>
              )}
              {p2pTarget && p2pMode === 'borrow' && (() => {
                const willOverLimit = existingLoanTotal + p2pAmount > loanLimit;
                return (
                  <div className="text-xs text-gray-400">
                    你月還款：<span className="text-yellow-300">${fmt(Math.round(p2pAmount * p2pRate))}</span>
                    {'  '}你拿到：<span className="text-emerald-400">${fmt(p2pAmount)}</span>
                    <div className={`mt-1 ${willOverLimit ? 'text-red-400' : 'text-gray-400'}`}>
                      可借餘額：${fmt(availableLoan)}
                      {willOverLimit && '（超過信用上限）'}
                    </div>
                  </div>
                );
              })()}
              <div className="grid grid-cols-2 gap-2">
                <button className="btn-secondary text-sm" onClick={() => setShowP2PPanel(false)}>取消</button>
                {p2pMode === 'lend' ? (
                  <button
                    className="btn-primary text-sm"
                    disabled={!p2pTarget || player.cash < p2pAmount}
                    onClick={() => { onLoanOffer(p2pTarget, p2pAmount, p2pRate); setShowP2PPanel(false); setP2pTarget(''); }}
                  >發送借款邀請</button>
                ) : (
                  <button
                    className="btn-primary text-sm"
                    disabled={!p2pTarget || existingLoanTotal + p2pAmount > loanLimit}
                    onClick={() => { onLoanRequest(p2pTarget, p2pAmount, p2pRate); setShowP2PPanel(false); setP2pTarget(''); }}
                  >發送借款請求</button>
                )}
              </div>
            </div>
          ) : (
            <button className="btn-secondary w-full text-sm" onClick={() => setShowP2PPanel(true)}>
              🤝 借款 / 借入（P2P）
            </button>
          )}
        </div>
      )}

      {/* ── 持有資產（含賣出） ────────── */}
      {player.assets && player.assets.length > 0 && (
        <div className="card">
          <p className="text-xs text-gray-400 mb-2">持有資產</p>
          <div className="space-y-2">
            {player.assets.filter((asset) => !asset.id.startsWith('car-')).map((asset) => {
              const isSellConfirming = sellConfirmId === asset.id;
              const netChange = (asset.currentValue ?? asset.cost) - (asset.linkedLiabilityId
                ? (player.liabilities?.find((l) => l.id === asset.linkedLiabilityId)?.totalDebt ?? 0)
                : 0);
              return (
                <div key={asset.id} className="rounded-xl border border-gray-600 bg-gray-750 px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">{asset.name}</span>
                    <span className={`text-xs font-bold ${asset.monthlyCashflow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {asset.monthlyCashflow >= 0 ? '+' : ''}${fmt(asset.monthlyCashflow)}/月
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>市值 <span className="text-yellow-300">${fmt(asset.currentValue ?? asset.cost)}</span></span>
                    {asset.linkedLiabilityId && (
                      <span>還款後淨得 <span className={netChange >= 0 ? 'text-emerald-400' : 'text-red-400'}>${fmt(netChange)}</span></span>
                    )}
                  </div>
                  {isSellConfirming ? (() => {
                    const value = asset.currentValue ?? asset.cost;
                    const debt = asset.linkedLiabilityId ? (player.liabilities?.find((l) => l.id === asset.linkedLiabilityId)?.totalDebt ?? 0) : 0;
                    const isHome = asset.id.startsWith('home-');
                    const fee = isHome ? Math.round(value * (info?.homeTransactionCostRate ?? 0.03)) : 0;
                    const tax = isHome ? 0 : Math.round(Math.max(0, value - asset.cost) * (info?.capitalGainsTaxRate ?? 0.2));
                    const net = value - debt - fee - tax;
                    return (
                      <EffectPreview title={`賣出 ${asset.name}：效果與價值`} rows={[
                        { label: '市價', value: `+$${fmt(value)}`, tone: 'good' },
                        ...(debt ? [{ label: '清償連結負債', value: `-$${fmt(debt)}`, tone: 'bad' as const }] : []),
                        ...(fee ? [{ label: '交易稅費 3%', value: `-$${fmt(fee)}`, tone: 'bad' as const }] : []),
                        ...(isHome ? [] : [{ label: `資本利得稅（獲利 $${fmt(Math.max(0, value - asset.cost))} × 20%）`, value: `-$${fmt(tax)}`, tone: (tax ? 'bad' : 'neutral') as 'bad' | 'neutral' }]),
                        { label: '淨入帳', value: `${net >= 0 ? '+' : '-'}$${fmt(Math.abs(net))}`, tone: net >= 0 ? 'good' : 'bad' },
                        ...(asset.monthlyCashflow ? [{ label: '失去月現金流', value: `${asset.monthlyCashflow > 0 ? '-' : '+'}$${fmt(Math.abs(asset.monthlyCashflow))}/月`, tone: (asset.monthlyCashflow > 0 ? 'bad' : 'good') as 'bad' | 'good' }] : []),
                        ...(isHome ? [{ label: '之後房租', value: `-$${fmt(player.profession ? Math.round((player.expenses.rent || 0) || 0) : 0)}/月起（回到租屋）`, tone: 'bad' as const }] : []),
                        { label: '賣出後現金', value: `$${fmt(player.cash + net)}`, tone: 'neutral' },
                      ]} notes={[isHome ? '自住房免資本利得稅；賣掉後房租依職業設定並隨物價上漲' : '成本 $' + fmt(asset.cost) + '；賣出後就沒有這筆被動收入', '賣出不影響信用分；危機自救時可用來補足費用']}
                        confirmLabel="確認賣出" onCancel={() => setSellConfirmId(null)}
                        onConfirm={() => { onSellAsset(asset.id); setSellConfirmId(null); }} />
                    );
                  })() : (
                    <button
                      className="w-full text-xs py-1 rounded-lg border border-gray-600 text-gray-300 hover:border-red-500 hover:text-red-400 transition-colors"
                      onClick={() => setSellConfirmId(asset.id)}
                    >賣出</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 轉職 ──────────────────────── */}
      {careerChangeData && onCareerChange && (
        <div className="card border-2 border-yellow-500">
          <p className="text-xs text-yellow-400 font-bold mb-1">🎯 技能巔峰 — 可以轉職！</p>
          <p className="text-xs text-gray-300 mb-2">{careerChangeData.message}</p>
          <p className="text-[11px] text-amber-300 mb-2">轉職至 B/I 象限需以現金買入起始事業/投資資產（自有資金部分）。</p>
          {careerPreview && (() => {
            const prof = careerChangeData.availableProfessions.find((x) => x.id === careerPreview);
            if (!prof) return null;
            const cost = prof.assetCost ?? 0;
            return <EffectPreview title={`轉職為 ${prof.name}：效果與價值`} rows={[
              { label: '月薪', value: `$${fmt(player.salary)} → ${prof.salary !== undefined ? `$${fmt(prof.salary)}` : '依新職業'}${prof.quadrant === 'S' ? '（動態薪）' : ''}`, tone: 'neutral' },
              ...(cost ? [{ label: '買入起始事業／投資資產', value: `-$${fmt(cost)}`, tone: 'bad' as const }] : []),
              ...(prof.startingFQ ? [{ label: '財商 FQ', value: `${player.stats.financialIQ} → ${Math.max(player.stats.financialIQ, prof.startingFQ)}`, tone: 'good' as const }] : []),
              { label: '第二專長 SK', value: `${player.stats.careerSkill} → 0（重新累積）`, tone: 'bad' },
              { label: '年資加薪倍率', value: `×${(player.salaryGrowthMultiplier ?? 1).toFixed(2)} 保留`, tone: 'good' },
              { label: '生命體驗', value: '+10', tone: 'good' },
            ]} notes={['信用卡與生活支出改依新職業；房租／房貸、車貸、保險、資產、負債、人脈都保留', 'B／I 象限：薪資低或為零，收入來自起始事業或投資組合的現金流', '主持人會在大螢幕開轉職舞台，你確認後才生效']}
              confirmLabel="送出轉職申請" onCancel={() => setCareerPreview(null)}
              onConfirm={() => { onCareerChange(prof.id); setCareerPreview(null); }} />;
          })()}
          <div className="space-y-1">
            {careerChangeData.availableProfessions.map((prof) => {
              const cost = prof.assetCost ?? 0;
              const affordable = prof.canAfford !== false;
              const isBI = prof.quadrant === 'B' || prof.quadrant === 'I';
              return (
                <button
                  key={prof.id}
                  disabled={!affordable}
                  className={`w-full text-left text-xs px-3 py-2 rounded-xl border transition-colors ${
                    affordable
                      ? 'bg-yellow-900/40 hover:bg-yellow-900/70 border-yellow-700 text-yellow-200'
                      : 'bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed'
                  }`}
                  onClick={() => affordable && setCareerPreview(prof.id)}
                  title={cost > 0 ? `需付資產成本 $${cost.toLocaleString()}` : ''}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold">{prof.name}</span>
                    {prof.quadrant && (
                      <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full ${
                        prof.quadrant === 'I' ? 'bg-emerald-700 text-white' :
                        prof.quadrant === 'B' ? 'bg-amber-700 text-white' :
                        prof.quadrant === 'S' ? 'bg-purple-700 text-white' :
                        'bg-blue-700 text-white'
                      }`}>{prof.quadrant}</span>
                    )}
                  </div>
                  {isBI && cost > 0 && (
                    <span className={`block text-[10px] mt-0.5 ${affordable ? 'text-emerald-300' : 'text-red-400'}`}>
                      需付資產成本 ${cost.toLocaleString()}
                      {!affordable && '（現金不足）'}
                      {prof.startingFQ ? ` ｜ FQ→${prof.startingFQ}` : ''}
                    </span>
                  )}
                  {prof.description && <span className="block text-gray-400 text-xs mt-0.5">{prof.description}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 決策歷程只在賽後復盤開放，避免遊戲中形成提示。 */}
      {isGameOver ? (
        <button className="btn-primary w-full" onClick={onRequestAnalysis}>
          📊 查看人生分析報告
        </button>
      ) : null}
    </div>
  );
}
