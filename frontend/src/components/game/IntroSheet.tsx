interface Props { onClose?: () => void; mode?: 'fullscreen' | 'sheet' }

const sections = [
  ['一起看大螢幕', '輪到你時擲骰，跟著棋子走。事件、選項與結果都會公開；手機用來確認自己的決定。下一位會等本次事件結束才開始。'],
  ['選擇走哪條人生路', '第一人生有 24 個節點；04、14 是岔路，事業與生活路線長度相同。選路不是同時走兩邊，兩條支線會在生活服務站匯合。'],
  ['走到格子才做決定', '出國旅遊、人際關係、家庭抉擇、進修等，都在對應格子選擇。沒有每輪固定行動選單。每次服務站只辦一項；路過時可停下，剩餘步數作廢。'],
  ['可以取消，不急著按確認', '查看選项不扣款；按「取消，返回選項」可以重選。確認送出後，由主持人揭曉才生效。倒數是討論提醒，不會自動替你選。'],
  ['回合、年齡與收支', '全體完成一輪，人生推進四年。依開始工作的年齡計算，不會年齡倒退。薪資、配息、費用與稅由系統結算成同一張摘要，請一起核對。'],
  ['金錢以外的能力', 'HP 是健康；SK 是職涯技能；FQ 是財商；NT 是人脈。也要留意體驗、關係與家庭連結。每項選擇的費用與影響會在確認前說明。'],
  ['轉職與退休', 'SK 達到 100 且符合健康等條件，可申請轉職，由主持人安排舞台。符合退休階段的人同時在手機選擇，全部確認後一次揭曉，不逐人等候。'],
  ['家庭沒有標準答案', '可能遇到照護、親友資助、孩子的選擇、伴侶關係與個人界線。婚育不是唯一道路；不舒服的情境可換成一般關係情境，不需要分享私事。'],
  ['第二人生不是只看錢', '需先走過 24 第二人生格，達到最低結算月數，並連續兩輪結算符合：有效被動收入覆蓋 100% 支出＋兩項人生指標，或覆蓋 90%＋三項指標。達標後由主持人揭曉，不必再走到那格。'],
  ['結束後一起復盤', '我們會回顧每個決定帶來的結果，而不是用遊戲分數評斷一個人的人生。比較選擇、代價與當時的理由；攻略留到復盤再討論。'],
];

export default function IntroSheet({ onClose, mode = 'sheet' }: Props) {
  return <section className="flex h-full flex-col bg-slate-950 text-white" aria-label="遊戲前導說明">
    <header className="flex items-center justify-between border-b border-slate-600 p-5">
      <h2 className="text-2xl font-black text-emerald-300">百歲人生・怎麼玩</h2>
      {onClose && <button type="button" className="min-h-12 rounded-xl border px-4 text-lg" onClick={onClose}>關閉</button>}
    </header>
    <div className={`overflow-y-auto p-5 ${mode === 'fullscreen' ? 'grid grid-cols-2 gap-5' : 'space-y-5'}`}>
      {sections.map(([title,body],i)=><article key={title} className="rounded-2xl border border-slate-600 bg-slate-900 p-5">
        <h3 className="mb-3 text-xl font-bold text-amber-200">{i+1}. {title}</h3><p className="text-lg leading-relaxed">{body}</p>
      </article>)}
    </div>
  </section>;
}
