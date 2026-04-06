import { useState } from 'react';

const STRATEGY_CARDS = [
  {
    icon: '💰',
    title: '現金流 vs 薪水',
    question: '你在追什麼？',
    body: '薪水每個月歸零，現金流才會月月累積。脫出老鼠賽跑的條件是：被動收入 ≥ 每月支出。越早建立現金流資產，越快獲得時間自由。',
    color: 'border-emerald-600',
    highlight: 'text-emerald-400',
  },
  {
    icon: '🔲',
    title: '四象限的代價',
    question: '你站在哪個象限？',
    body: 'E（受雇）/ S（自雇）用時間換薪水，停工就停收。B（企業主）/ I（投資者）讓系統和資產為你工作。職業選擇決定你的行動自由度和成長上限。',
    color: 'border-blue-600',
    highlight: 'text-blue-400',
  },
  {
    icon: '🧠',
    title: '投資自己值得嗎？',
    question: '先花錢，還是先存錢？',
    body: '提升 FQ 讓投資回報更高；培訓 SK 解鎖轉職機會；拓展 NT 開啟人脈保護和抽牌優勢。這些都要先花錢，但決定你後期的天花板。',
    color: 'border-yellow-600',
    highlight: 'text-yellow-400',
  },
  {
    icon: '🛡️',
    title: '風險怎麼管？',
    question: '危機來臨前，你準備好了嗎？',
    body: '保險在危機發生後才買是來不及的。每次發薪日都可以購入醫療、壽險、財產險。有保險的危機只需付部分費用，沒保險可能讓你一夕歸零。',
    color: 'border-red-600',
    highlight: 'text-red-400',
  },
  {
    icon: '🌱',
    title: '人生不只是財報',
    question: '最後只剩數字，值得嗎？',
    body: '最終幸福指數由「生命體驗、人生成就、人際關係」三大面向組成。旅遊、結婚、子女、維持健康，都會影響你的最終得分，不是只有存錢。',
    color: 'border-pink-600',
    highlight: 'text-pink-400',
  },
];

const FREE_ACTIONS = [
  { icon: '✈️', name: '旅遊', desc: '消耗現金和少量 HP，獲得生命體驗。部分目的地額外提升 FQ、NT 或 SK。' },
  { icon: '🤝', name: '社交活動', desc: '花費時間與金錢，提升人脈（NT）。NT 越高，危機豁免與交易加成效果越強。' },
  { icon: '📈', name: '股票定期定額', desc: '任何時候都可投入，指數基金每次發薪日自動複利增長。定期定額降低進場時機的風險。' },
  { icon: '🏥', name: '購買保險', desc: '醫療險、壽險、財產險三種。每種保險保護不同的危機類型，每月扣除保費。' },
  { icon: '🏦', name: '應急借款', desc: '信用分越高，借款上限越高、利率越低。借款後每月扣除本利，請謹慎使用。' },
  { icon: '💼', name: '出售資產', desc: '隨時可賣出名下資產。市值低於成本時出售會虧損；繁榮市場時賣出可獲利。' },
];

const PAYDAY_DECISIONS = [
  { icon: '🧠', name: '提升財商 FQ', cost: '每次固定費用', effect: 'FQ +1，提高資產回報倍率，解鎖高階投資選項' },
  { icon: '💪', name: 'HP 強化', cost: '固定費用', effect: 'HP 大幅回升，抵抗老年 HP 衰退' },
  { icon: '🩺', name: 'HP 維護', cost: '低費用', effect: '本次發薪日 HP 不衰退（不回復，只維持）' },
  { icon: '🛠️', name: '職涯培訓 SK', cost: '固定費用', effect: 'SK 提升，累積達 100 可解鎖轉職' },
  { icon: '🌐', name: '拓展人脈 NT', cost: '固定費用', effect: 'NT 提升，達到 3/5/8 解鎖特殊效果' },
  { icon: '📈', name: '股票定投 DCA', cost: '自訂金額', effect: '投入指數基金，每月複利。下次發薪日即開始增值' },
  { icon: '🛡️', name: '購買保險', cost: '啟用費 + 月保費', effect: '保護未來危機，每月從薪資中扣除保費' },
];

const STAT_EFFECTS = [
  {
    icon: '🧠',
    name: 'FQ 財商',
    color: 'text-yellow-400',
    bg: 'bg-yellow-950',
    border: 'border-yellow-700',
    levels: [
      { range: '1–3', effect: '基礎投資能力，只能接受小交易' },
      { range: '4–6', effect: '可參與大交易，資產回報加成 +10%' },
      { range: '7–9', effect: '高槓桿投資解鎖，資產回報加成 +25%' },
      { range: '10', effect: '最高財商，交易選擇最多，回報最大化' },
    ],
  },
  {
    icon: '💪',
    name: 'HP 健康',
    color: 'text-green-400',
    bg: 'bg-green-950',
    border: 'border-green-700',
    levels: [
      { range: '80–100', effect: '完全行動，可參與所有大型活動' },
      { range: '40–79', effect: '正常行動，部分高耗體力活動受限' },
      { range: '10–39', effect: '行動受限，無法旅遊、大型交易' },
      { range: '0', effect: '臥床，跳過回合；持續低 HP 有機率死亡' },
    ],
  },
  {
    icon: '🛠️',
    name: 'SK 技能',
    color: 'text-blue-400',
    bg: 'bg-blue-950',
    border: 'border-blue-700',
    levels: [
      { range: '0–49', effect: '初級，維持現有職業' },
      { range: '50–99', effect: '中級，薪資小幅提升' },
      { range: '100', effect: '技能巔峰！解鎖「轉職」，可升級職業' },
    ],
  },
  {
    icon: '🌐',
    name: 'NT 人脈',
    color: 'text-purple-400',
    bg: 'bg-purple-950',
    border: 'border-purple-700',
    levels: [
      { range: '1–2', effect: '基礎人脈，無額外效果' },
      { range: '3', effect: '危機豁免解鎖：一生中可跳過一次危機事件' },
      { range: '5', effect: '抽牌加成：落在交易格可抽 2 張牌' },
      { range: '8', effect: '人脈大師：達成成就，人際關係評分大幅提升' },
    ],
  },
];

type Tab = 'strategy' | 'actions' | 'stats';

interface Props {
  onClose?: () => void;
  mode?: 'fullscreen' | 'sheet';
}

export default function IntroSheet({ onClose, mode = 'sheet' }: Props) {
  const [tab, setTab] = useState<Tab>('strategy');

  const isFullscreen = mode === 'fullscreen';

  return (
    <div className={`flex flex-col bg-gray-950 text-white ${isFullscreen ? 'h-full' : 'h-full'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
        <div>
          <h2 className="text-lg font-bold text-emerald-400">百歲人生 — 策略指南</h2>
          <p className="text-xs text-gray-500">帶著這些問題進場，讓每個決定更有意識</p>
        </div>
        {onClose && (
          <button className="text-gray-400 hover:text-white text-2xl leading-none px-2" onClick={onClose}>
            ×
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 flex-shrink-0">
        {([
          { id: 'strategy', label: '策略思考' },
          { id: 'actions', label: '可以做什麼' },
          { id: 'stats', label: '數值效果' },
        ] as { id: Tab; label: string }[]).map((t) => (
          <button
            key={t.id}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
              tab === t.id ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-gray-500 hover:text-gray-300'
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">

        {/* ── Tab 1: 策略思考 ── */}
        {tab === 'strategy' && (
          <div className={isFullscreen ? 'grid grid-cols-2 xl:grid-cols-3 gap-3' : 'space-y-3'}>
            {STRATEGY_CARDS.map((card) => (
              <div key={card.title} className={`rounded-xl border ${card.color} bg-gray-900 p-4`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-2xl">{card.icon}</span>
                  <span className={`text-sm font-bold ${card.highlight}`}>{card.title}</span>
                </div>
                <p className={`text-xs font-semibold mb-1 ${card.highlight}`}>「{card.question}」</p>
                <p className="text-xs text-gray-300 leading-relaxed">{card.body}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Tab 2: 可以做什麼 ── */}
        {tab === 'actions' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 px-1">隨時可做的行動</h3>
              <div className={isFullscreen ? 'grid grid-cols-3 gap-2' : 'space-y-2'}>
                {FREE_ACTIONS.map((a) => (
                  <div key={a.name} className="flex gap-3 bg-gray-900 rounded-xl p-3">
                    <span className="text-xl flex-shrink-0">{a.icon}</span>
                    <div>
                      <p className="text-sm font-semibold text-white">{a.name}</p>
                      <p className="text-xs text-gray-400 leading-snug mt-0.5">{a.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 px-1">每次發薪日的決策選項</h3>
              <div className={isFullscreen ? 'grid grid-cols-3 gap-2' : 'space-y-2'}>
                {PAYDAY_DECISIONS.map((d) => (
                  <div key={d.name} className="flex gap-3 bg-gray-900 rounded-xl p-3">
                    <span className="text-xl flex-shrink-0">{d.icon}</span>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-white">{d.name}</p>
                        <span className="text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">{d.cost}</span>
                      </div>
                      <p className="text-xs text-emerald-300 leading-snug mt-0.5">{d.effect}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Tab 3: 數值效果 ── */}
        {tab === 'stats' && (
          <div className={isFullscreen ? 'grid grid-cols-2 gap-3' : 'space-y-3'}>
            {STAT_EFFECTS.map((stat) => (
              <div key={stat.name} className={`rounded-xl border ${stat.border} ${stat.bg} p-4`}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">{stat.icon}</span>
                  <span className={`text-base font-bold ${stat.color}`}>{stat.name}</span>
                </div>
                <div className="space-y-1.5">
                  {stat.levels.map((lv) => (
                    <div key={lv.range} className="flex gap-3 items-start">
                      <span className={`text-xs font-mono font-bold ${stat.color} bg-black/30 px-1.5 py-0.5 rounded flex-shrink-0`}>
                        {lv.range}
                      </span>
                      <span className="text-xs text-gray-300 leading-snug">{lv.effect}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
