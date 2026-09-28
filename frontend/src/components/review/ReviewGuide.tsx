// 終局復盤引導：告訴全場接下來怎麼看、怎麼談（取代開局用的策略說明）
const STEPS = [
  { icon: '📈', title: '人生曲線', body: '先看每個人的淨資產與現金流怎麼走，找出曲線在哪個年紀開始分岔。' },
  { icon: '🗳️', title: '共同抉擇回顧', body: '全場一起做過的選擇，誰受益、誰付出？個人最划算和全體最好，是同一個答案嗎？' },
  { icon: '🏅', title: '隱藏獎項', body: '一個一個揭曉，每個獎項配一個問題，請得獎者先說當時怎麼想。' },
  { icon: '🔍', title: '個人分析', body: '挑一兩位玩家投影，看他們影響最大的三個決定。' },
  { icon: '🏆', title: '最後才看排名', body: '分數只是其中一種衡量。排名放最後，大家才會先談選擇，而不是先比輸贏。' },
];

const PRINCIPLES = [
  { title: '談選擇，不談運氣', body: '骰子和卡片是環境。要討論的是：拿到這張牌之後，你做了什麼？' },
  { title: '回到當時知道的事', body: '不用事後的結果評斷當時的決定。問：「那時候你看到什麼、擔心什麼？」' },
  { title: '沒有標準答案', body: '存很多、玩很多、陪家人，都是一種人生。說出你為什麼這樣選。' },
  { title: '連到真實人生', body: '每一段最後問一句：「這件事在你現在的生活裡，長什麼樣子？」' },
];

export default function ReviewGuide() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="text-center">
        <p className="text-sm font-black uppercase tracking-[0.3em] text-emerald-400">Life Review</p>
        <h2 className="mt-2 text-4xl font-black text-white">一起回看這一百年</h2>
        <p className="mt-2 text-lg text-gray-300">接下來依序看五個畫面。先談過程，最後才看分數。</p>
      </div>
      <ol className="grid gap-3 md:grid-cols-5">
        {STEPS.map((step, index) => (
          <li key={step.title} className="rounded-2xl border border-emerald-800 bg-emerald-950/40 p-4">
            <div className="text-3xl" aria-hidden="true">{step.icon}</div>
            <p className="mt-2 text-sm font-bold text-emerald-300">第 {index + 1} 步</p>
            <p className="text-xl font-black text-white">{step.title}</p>
            <p className="mt-2 text-sm leading-relaxed text-gray-300">{step.body}</p>
          </li>
        ))}
      </ol>
      <div>
        <h3 className="mb-3 text-xl font-black text-indigo-200">討論的四個原則</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {PRINCIPLES.map((item) => (
            <div key={item.title} className="rounded-2xl border border-indigo-800 bg-indigo-950/40 p-4">
              <p className="text-lg font-black text-white">{item.title}</p>
              <p className="mt-1 text-base leading-relaxed text-gray-300">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
