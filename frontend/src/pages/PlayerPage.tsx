import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import type { GameState, Player, PlayerAnalysis, ActiveEvent, PaydayFormData, PaydayPlanPayload, LifeChoice } from '../types/game';
import FinancialStatement from '../components/game/FinancialStatement';
import DiceRoller from '../components/game/DiceRoller';
import DiceRollOverlay, { type DiceRollData } from '../components/game/DiceRollOverlay';
import ActionPanel from '../components/game/ActionPanel';
import AnalysisPage from './AnalysisPage';
import EventCard from '../components/game/EventCard';
import PaydayPlanForm from '../components/game/PaydayPlanForm';
import CollapsePanel from '../components/game/CollapsePanel';
import { innerCircleConfig, outerCircleConfig } from '../components/game/boardConfig';
import IntroSheet from '../components/game/IntroSheet';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';
const fmt = (n: number) => n.toLocaleString('zh-TW', { maximumFractionDigits: 0 });

type View = 'join' | 'pre20' | 'game' | 'analysis' | 'gameover';

interface AvailableProfession {
  id: string;
  name: string;
  quadrant: string;
  startingSalary: number;
  salaryType?: string;
  hasFlexibleSchedule?: boolean;
}

const SOCIAL_CLASS_LABELS: Record<string, string> = {
  Wealthy: '富裕階層',
  UpperMiddle: '中上階層',
  Middle: '中等階層',
  LowerClass: '小康/貧窮',
};

const GROWTH_FIELDS: { key: 'academic' | 'health' | 'social' | 'resource'; label: string; desc: string }[] = [
  { key: 'academic', label: '學業', desc: '影響可選職業資格與職涯技能初始值' },
  { key: 'health',   label: '體能', desc: '影響初始 HP 健康值' },
  { key: 'social',   label: '社交', desc: '影響初始 NT 人脈值' },
  { key: 'resource', label: '資源', desc: '每點 +$3,000 起始現金；亦是 B/I 象限門檻' },
];

// B1：人生夢想清單顯示資料（與後端 BUCKET_LIST_GOALS 對應）
const BUCKET_GOAL_LABELS: Record<string, { emoji: string; title: string; desc: string }> = {
  world_traveler:     { emoji: '🌍', title: '環遊世界',     desc: '造訪 5 個不同的旅遊目的地' },
  philanthropist:     { emoji: '❤️', title: '慈善家',       desc: '累積慈善捐款達 $200,000' },
  tycoon:             { emoji: '💰', title: '財富自由',     desc: '淨資產達到 $5,000,000' },
  family_man:         { emoji: '👨\u200d👩\u200d👧', title: '溫暖家庭',     desc: '結婚並擁有至少 2 個孩子' },
  cashflow_king:      { emoji: '👑', title: '被動收入之王', desc: '月被動收入達 $30,000 以上' },
  real_estate_baron:  { emoji: '🏘️', title: '不動產大亨',   desc: '同時擁有 3 個以上不動產' },
  high_fq:            { emoji: '🧠', title: '財商達人',     desc: '財商等級提升到 8 以上' },
  long_life:          { emoji: '🎂', title: '長壽人生',     desc: '健康存活到 80 歲' },
};

// ── 常數與型別 ──

export default function PlayerPage() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [myId, setMyId] = useState<string>('');
  const [view, setView] = useState<View>('join');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [analysis, setAnalysis] = useState<PlayerAnalysis | null>(null);
  const [notifications, setNotifications] = useState<string[]>([]);
  const [lastRoll, setLastRoll] = useState<{ rolled: number; newPosition: number } | undefined>();
  const [rollingLocked, setRollingLocked] = useState(false);
  const [diceAnim, setDiceAnim] = useState<DiceRollData | null>(null);

  // 互動機制 state
  type CongratulatableEvent = { targetId: string; targetName: string; event: string };
  type ActiveAuction = {
    auctionId: string; triggeredByName: string; endsAt: number;
    card?: { id: string; name: string; description?: string; minBid: number; monthlyCashflow?: number };
    minBid: number; highestBid: number; highestBidderName?: string;
  };
  type PartnershipOffer = { offerId: string; offerorName: string; targetId: string };
  type LoanOffer = { offerId: string; lenderName: string; borrowerId: string; amount: number; monthlyRate: number };
  type LoanRequest = { requestId: string; borrowerName: string; lenderId: string; amount: number; monthlyRate: number };
  const [congratulatableEvent, setCongratulatableEvent] = useState<CongratulatableEvent | null>(null);
  const [activeAuction, setActiveAuction] = useState<ActiveAuction | null>(null);
  const [auctionBid, setAuctionBid] = useState('');
  const [partnershipOffer, setPartnershipOffer] = useState<PartnershipOffer | null>(null);
  const [partnershipChoice, setPartnershipChoice] = useState<{ availablePartners: { id: string; name: string }[] } | null>(null);
  const [loanOffer, setLoanOffer] = useState<LoanOffer | null>(null);
  const [loanRequest, setLoanRequest] = useState<LoanRequest | null>(null);

  // 格子事件 & 發薪日表單
  const [activeEvent, setActiveEvent] = useState<ActiveEvent | null>(null);
  const [paydayForm, setPaydayForm] = useState<PaydayFormData | null>(null);
  const [careerChangeData, setCareerChangeData] = useState<{
    message: string;
    availableProfessions: AvailableProfession[];
  } | null>(null);
  const [careerChangeCelebration, setCareerChangeCelebration] = useState<{
    previousProfession: string;
    newProfession: string;
    salaryChange?: number;
  } | null>(null);
  const [showIntro, setShowIntro] = useState(false);

  // Join form state — pre-fill room code from URL ?room=XXX
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get('room') ?? '').toUpperCase();
  });
  // 只有從 URL 帶入房間碼時才預設為「已鎖定」；手動輸入時一直維持輸入框
  const [roomLocked, setRoomLocked] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get('room') ?? '').length > 0;
  });
  const [error, setError] = useState('');

  // Pre-20 state
  type Pre20Step = 'roll' | 'allocate' | 'career' | 'done';
  const [pre20Step, setPre20Step] = useState<Pre20Step>('roll');
  const [growthAlloc, setGrowthAlloc] = useState({ academic: 0, health: 0, social: 0, resource: 0 });
  const [, setAvailableProfessions] = useState<AvailableProfession[]>([]);
  const [canEducation, setCanEducation] = useState(false);

  const addNotification = (msg: string) => {
    setNotifications((prev) => [msg, ...prev].slice(0, 5));
  };

  useEffect(() => {
    const s = io(SERVER_URL, {
      transports: ['websocket', 'polling'], // polling 作為 WebSocket 失敗時的備援
      reconnection: true,
      reconnectionAttempts: Infinity, // 永不放棄重連，避免長時間遊戲後斷線無法恢復
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      timeout: 20000,
    });
    socketRef.current = s;

    s.on('connect', () => {
      setConnected(true);
      setMyId(s.id ?? '');

      // 嘗試從 localStorage 自動重連恢復資料
      const saved = localStorage.getItem('baisuiGame');
      if (saved) {
        try {
          const { playerName: savedName, roomCode: savedRoom } = JSON.parse(saved) as { playerName: string; roomCode: string };
          if (savedName && savedRoom) {
            s.emit('playerRejoin', { playerName: savedName, roomCode: savedRoom });
          }
        } catch { /* 忽略格式錯誤 */ }
      }
    });
    s.on('disconnect', () => setConnected(false));
    s.on('error', (p: { message: string }) => {
      setError(p.message);
      setRollingLocked(false);
      // 若伺服器端遺失了我們的房間記錄（Railway 重啟、idle 重置等），
      // 主動把使用者帶回加入頁，避免一直停留在已失效的遊戲畫面
      if (p.message?.includes('尚未加入') || p.message?.includes('房間') && p.message?.includes('不存在')) {
        localStorage.removeItem('baisuiGame');
        setGameState(null);
        setView('join');
      }
    });

    // 重連成功
    s.on('rejoinSuccess', () => {
      addNotification('✅ 重連成功，已恢復遊戲資料！');
    });

    // 重連失敗（資料已過期或房間不存在 — 通常是後端重啟導致）
    s.on('rejoinFailed', (p?: { message?: string }) => {
      localStorage.removeItem('baisuiGame');
      setGameState(null);
      setView('join');
      setError(p?.message ?? '伺服器資料已過期，請重新加入房間。');
    });

    s.on('gameStateUpdate', (gs: GameState) => {
      setGameState(gs);
      const amIInGame = gs.players.some((p) => p.id === s.id);
      if (gs.gamePhase === 'GameOver') { setView('gameover'); localStorage.removeItem('baisuiGame'); }
      else if (amIInGame && gs.gamePhase === 'Pre20') setView((v) => v === 'join' ? 'pre20' : v);
      else if (amIInGame && ['RatRace', 'FastTrack'].includes(gs.gamePhase)) setView((v) => (v === 'pre20' || v === 'join') ? 'game' : v);
      // 輪到自己時解除擲骰鎖定（以防 rollResult 沒有正確觸發）
      if (gs.currentPlayerTurnId === s.id) setRollingLocked(false);
    });

    s.on('socialClassRolled', (p: { socialClass: string; label: string; growthPoints: number; startingCashBonus: number }) => {
      addNotification(`投胎完成：${p.label}，成長點數 ${p.growthPoints}，現金加成 $${fmt(p.startingCashBonus)}`);
      setView('pre20');
      setPre20Step('allocate');
      setGrowthAlloc({ academic: 0, health: 0, social: 0, resource: 0 });
    });

    s.on('growthStatsApplied', (p: { stats: unknown; availableProfessions: AvailableProfession[]; canContinueEducation: boolean; resourceCashGain?: number }) => {
      setAvailableProfessions(p.availableProfessions);
      setCanEducation(p.canContinueEducation);
      if (p.resourceCashGain && p.resourceCashGain > 0) {
        addNotification(`💰 資源點數轉換：起始現金 +$${fmt(p.resourceCashGain)}`);
      }
      setPre20Step('career');
    });

    s.on('educationLoanApplied', (p: { newFQ: number; lifeExpGained: number; availableProfessions: AvailableProfession[] }) => {
      setAvailableProfessions(p.availableProfessions);
      addNotification(`繼續進修！FQ 提升至 ${p.newFQ}，解鎖高階職業。下一個回合將跳過（進修代價）。`);
    });

    s.on('professionAssigned', (p: { profession: { name: string; quadrant: string }; quadrant: string; initialCashflow: number }) => {
      addNotification(`職業分配：${p.profession.name}（${p.quadrant} 象限），月現金流 $${fmt(p.initialCashflow)}`);
      setPre20Step('done');
    });

    s.on('rollResult', (p: { rolled: number; newPosition: number }) => {
      setLastRoll(p);
      setRollingLocked(false);
    });
    s.on('playerRolled', (p: { playerId: string; playerName: string; colorIndex: number; dice: number[]; total: number; oldPosition: number; newPosition: number }) => {
      // 只為自己播放動畫，避免他人擲骰時干擾自己手機畫面
      if (p.playerId !== s.id) return;
      setDiceAnim({ ...p, key: Date.now() });
    });
    s.on('paydayPlanningRequired', (p: PaydayFormData) => {
      setPaydayForm(p);
      addNotification('💰 發薪日到了！請規劃你的投資');
    });
    s.on('paydaySkipped', (_p: { playerId?: string; reason?: string }) => {
      addNotification('📚 進修中，本次發薪日跳過。');
    });
    s.on('turnSkipped', (p: { reason?: string; turnsRemaining?: number }) => {
      const reason = p.reason === 'bedridden' ? '臥床中' : p.reason === 'turnsToSkip' ? '行動跳過' : '回合跳過';
      const remaining = (p.turnsRemaining ?? 0) > 0 ? `（剩餘 ${p.turnsRemaining} 回）` : '';
      addNotification(`⏭️ ${reason}，本回合跳過${remaining}。`);
    });
    s.on('ratRaceEscaped', (p: { playerName: string; canCongratulate?: boolean; playerId?: string }) => {
      addNotification(`🎉 ${p.playerName} 脫出老鼠賽跑！`);
      if (p.canCongratulate && p.playerId !== s.id) {
        setCongratulatableEvent({ targetId: p.playerId ?? '', targetName: p.playerName, event: '脫出老鼠賽跑' });
      }
    });
    s.on('marriageWindowOpened', (p: { card: { title: string; description: string; monthlyBonus: number; lifeExpGain: number }; currentAge: number; inPeakWindow: boolean; timeoutMs: number }) => {
      setActiveEvent({
        kind: 'marriage_window',
        title: p.card.title,
        description: p.card.description,
        monthlyBonus: p.card.monthlyBonus,
        lifeExpGain: p.card.lifeExpGain,
        inPeakWindow: p.inPeakWindow,
        timeoutMs: p.timeoutMs,
      });
    });
    s.on('playerMarried', (p: { playerName: string; card: { title: string; monthlyBonus: number }; playerId?: string }) => {
      if (p.playerId === s.id) {
        addNotification(`💍 恭喜結婚！${p.card.title}，月收入 +$${p.card.monthlyBonus.toLocaleString()}`);
      } else {
        addNotification(`💍 ${p.playerName} 結婚了！`);
      }
    });
    s.on('marriageDeclined', (p: { playerName: string; playerId?: string }) => {
      if (p.playerId === s.id) {
        addNotification('💔 婉拒了這段緣分。');
      }
    });
    s.on('marriageAnnouncement', (p: { playerName: string; marriageType: string; playerId?: string; canCongratulate?: boolean }) => {
      addNotification(`💍 ${p.playerName} 結婚了！`);
      if (p.canCongratulate && p.playerId !== s.id) {
        setCongratulatableEvent({ targetId: p.playerId ?? '', targetName: p.playerName, event: '結婚' });
      }
    });
    s.on('dealAuctionStarted', (p: { auctionId: string; triggeredBy: string; triggeredByName: string; endsAt: number; isSpecialAuction?: boolean; card?: { id: string; name: string; description?: string; minBid: number; monthlyCashflow?: number }; }) => {
      // 特殊拍賣由主持人觸發，所有玩家都應該收到（包含主持人也不過濾，因主持人不是玩家）
      if (!p.isSpecialAuction && p.triggeredBy === s.id) return;
      const minBid = p.card?.minBid ?? 0;
      const durationSec = Math.max(1, Math.round((p.endsAt - Date.now()) / 1000));
      const prefix = p.isSpecialAuction
        ? `🔨 主持人開啟特殊拍賣！${durationSec} 秒內可搶標`
        : `🔔 ${p.triggeredByName} 放棄交易！${durationSec} 秒內可出價搶標`;
      addNotification(`${prefix}（${p.card?.name ?? ''}，起標 $${minBid.toLocaleString()}）`);
      setActiveAuction({ ...p, minBid, highestBid: 0 });
    });
    s.on('dealAuctionEnded', (p: { auctionId: string; winnerId?: string | null; winnerName?: string | null; winningBid: number; cardName?: string; hadBids?: boolean }) => {
      setActiveAuction(null);
      if (p.hadBids && p.winnerName) {
        addNotification(`🏆 競標結束：${p.winnerName} 以 $${fmt(p.winningBid)} 得標 ${p.cardName ?? ''}`);
        // 自己得標的話額外提示
        if (p.winnerId === s.id) {
          addNotification(`🎉 恭喜！你以 $${fmt(p.winningBid)} 競標到 ${p.cardName ?? '資產'}！`);
        }
      } else {
        addNotification(`🔔 競標結束，無人出價（${p.cardName ?? ''}）`);
      }
    });
    s.on('dealBidUpdated', (p: { bidderName: string; bidAmount: number; newHighest: number }) => {
      addNotification(`💰 ${p.bidderName} 出價 $${fmt(p.bidAmount)}`);
      setActiveAuction((prev) => prev ? { ...prev, highestBid: p.newHighest, highestBidderName: p.bidderName } : prev);
    });
    s.on('partnershipOpportunity', (p: { availablePartners: { id: string; name: string }[] }) => {
      addNotification('🤝 合夥機會！選擇一位玩家發起合夥邀請');
      setPartnershipChoice(p);
    });
    s.on('partnershipOfferReceived', (p: { offerId: string; offerorName: string; targetId: string }) => {
      if (p.targetId === s.id) {
        addNotification(`🤝 ${p.offerorName} 邀請你合夥投資！`);
        setPartnershipOffer(p);
      }
    });
    s.on('partnershipDeclined', (p: { offerorId: string; targetId: string }) => {
      if (p.offerorId === s.id) addNotification('❌ 對方婉拒了合夥邀請。');
    });
    s.on('partnershipAccepted', (p: { offerorName: string; targetName: string; dividend?: number; passiveSum?: number }) => {
      const dividendText = p.dividend
        ? `，合作分紅 +$${p.dividend.toLocaleString()}/人（雙方被動 $${(p.passiveSum ?? 0).toLocaleString()}）`
        : '';
      addNotification(`✅ 合夥成功：${p.offerorName} & ${p.targetName}（+15 體驗值${dividendText}）`);
      setPartnershipOffer(null);
      setPartnershipChoice(null);
    });
    s.on('loanOfferReceived', (p: { offerId: string; lenderName: string; borrowerId: string; amount: number; monthlyRate: number }) => {
      if (p.borrowerId === s.id) {
        addNotification(`💳 ${p.lenderName} 願意借你 $${fmt(p.amount)}（月息 ${(p.monthlyRate * 100).toFixed(1)}%）`);
        setLoanOffer(p);
      }
    });
    s.on('loanRequestReceived', (p: { requestId: string; borrowerId: string; borrowerName: string; lenderId: string; lenderName: string; amount: number; monthlyRate: number }) => {
      if (p.lenderId === s.id) {
        addNotification(`💸 ${p.borrowerName} 向你請求借款 $${fmt(p.amount)}（月息 ${(p.monthlyRate * 100).toFixed(1)}%）`);
        setLoanRequest({ requestId: p.requestId, borrowerName: p.borrowerName, lenderId: p.lenderId, amount: p.amount, monthlyRate: p.monthlyRate });
      } else if (p.borrowerId === s.id) {
        addNotification(`📨 已向 ${p.lenderName} 發出借款請求 $${fmt(p.amount)}（月息 ${(p.monthlyRate * 100).toFixed(1)}%），等待對方回應`);
      }
    });
    s.on('loanRequestDeclined', (p: { requestId: string; borrowerId: string; lenderId: string }) => {
      if (p.borrowerId === s.id) addNotification('❌ 對方拒絕了你的借款請求');
      if (p.lenderId === s.id) {
        addNotification('🛑 你已拒絕該借款請求');
        setLoanRequest(null);
      }
    });
    s.on('loanAccepted', (p: { lenderName: string; borrowerName: string; amount: number; initiatedBy?: string }) => {
      const verb = p.initiatedBy === 'borrower' ? '同意借出' : '借貸成交';
      addNotification(`✅ P2P ${verb}：${p.lenderName} → ${p.borrowerName} $${fmt(p.amount)}`);
      setLoanOffer(null);
      setLoanRequest(null);
    });
    s.on('congratulationSent', (p: { senderName: string; targetName: string; amount: number }) => {
      addNotification(`🎊 ${p.senderName} 恭喜了 ${p.targetName}（$${p.amount}）`);
    });
    s.on('playerFinalScore', (p: { playerName: string; deathAge: number; score: { total: number } }) => {
      addNotification(`${p.playerName} 在 ${p.deathAge} 歲結束人生（${p.score.total} 分）`);
    });
    s.on('globalEventAnnouncement', (p: { event: { title: string; description: string } }) => {
      addNotification(`📢 全局事件：${p.event?.title ?? ''} — ${p.event?.description ?? ''}`);
      setActiveEvent({ kind: 'global_event', title: p.event?.title ?? '全局事件', description: p.event?.description ?? '' });
    });
    s.on('squareLandingNotice', (p: { cellName: string; message: string }) => {
      addNotification(`📍 ${p.cellName}：${p.message}`);
    });
    s.on('playerAnalysis', (data: PlayerAnalysis) => {
      setAnalysis(data);
      setView('analysis');
    });
    s.on('cardApplied', (p: { playerId?: string; playerName?: string; effect?: { type?: string; cashDeducted?: number; monthlyExpenseIncrease?: number; card?: { title?: string; description?: string }; wasInsured?: boolean; effectiveCost?: number; turnsLost?: number } }) => {
      const isMe = p.playerId === s.id;
      // baby 保持全員通知（公開喜事）
      if (p.effect?.type === 'baby') addNotification(`👶 ${p.playerName ?? '有玩家'} 添丁！`);
      // doodad 結果
      if (isMe && (p.effect?.cashDeducted !== undefined || p.effect?.monthlyExpenseIncrease !== undefined)) {
        setActiveEvent({
          kind: 'doodad',
          title: p.effect.card?.title ?? '意外支出',
          description: p.effect.card?.description ?? '',
          cashDeducted: p.effect.cashDeducted ?? 0,
          expenseIncrease: p.effect.monthlyExpenseIncrease ?? 0,
        });
      }
      // crisis applied（有保險資訊 + 費用）
      if (isMe && p.effect?.effectiveCost !== undefined && p.effect.card?.title) {
        setActiveEvent({
          kind: 'crisis_applied',
          title: p.effect.card.title,
          description: p.effect.card.description ?? '',
          effectiveCost: p.effect.effectiveCost,
          turnsLost: p.effect.turnsLost ?? 0,
          wasInsured: p.effect.wasInsured ?? false,
        });
      }
    });

    // 格子事件監聽
    s.on('crisisNTSkipAvailable', (p: { card: { title: string; description: string; baseCost: number }; network?: number; timeoutMs: number }) => {
      setActiveEvent({ kind: 'crisis_nt_skip', title: p.card.title, description: p.card.description, baseCost: p.card.baseCost, network: p.network ?? 0, timeoutMs: p.timeoutMs });
    });
    s.on('dealCardsDrawn', (p: { cards: Array<{ id: string; name: string; description?: string; downPayment: number; monthlyCashflow: number }>; playerCash: number; creditScore?: number; loanAvailable?: number }) => {
      setActiveEvent({
        kind: 'deal_pick',
        cards: p.cards,
        playerCash: p.playerCash ?? 0,
        creditScore: p.creditScore,
        loanAvailable: p.loanAvailable,
      });
    });
    s.on('charityCardPending', (p: { amount: number }) => {
      setActiveEvent({ kind: 'charity', amount: p.amount });
    });
    s.on('techStartupOffer', (p: { investmentAmount: number; playerCash: number }) => {
      setActiveEvent({ kind: 'tech_startup_offer', investmentAmount: p.investmentAmount, playerCash: p.playerCash });
    });
    s.on('techStartupResult', (p: { success: boolean; diceRoll: number; investmentAmount: number; monthlyCashflow?: number }) => {
      setActiveEvent({ kind: 'tech_startup_result', success: p.success, diceRoll: p.diceRoll, investmentAmount: p.investmentAmount, monthlyCashflow: p.monthlyCashflow });
    });
    s.on('assetLeverageBonus', (p: { bonus: number; passiveIncome: number }) => {
      setActiveEvent({ kind: 'asset_leverage', bonus: p.bonus, passiveIncome: p.passiveIncome });
    });
    s.on('diseaseCrisisCard', (p: { crisis: { title: string; description: string }; result: { wasInsured: boolean; effectiveCost: number; turnsLost: number; deathTriggered: boolean }; hpBefore: number; hpAfter: number }) => {
      setActiveEvent({ kind: 'disease_crisis', title: p.crisis.title, description: p.crisis.description, effectiveCost: p.result.effectiveCost, turnsLost: p.result.turnsLost, hpBefore: p.hpBefore, hpAfter: p.hpAfter, wasInsured: p.result.wasInsured });
    });

    s.on('assetSold', (p: { assetId: string; proceeds: number; debtSettled: number; netCashChange: number }) => {
      const sign = p.netCashChange >= 0 ? '+' : '';
      addNotification(`💹 資產出售！淨收益 ${sign}$${p.netCashChange.toLocaleString()}（賣價 $${p.proceeds.toLocaleString()}${p.debtSettled > 0 ? `，清償負債 $${p.debtSettled.toLocaleString()}` : ''}）`);
    });

    // 發薪日規劃完成廣播：非當前玩家自動回報 planningDone，避免遊戲卡住等待 30 秒
    s.on('paydayPlanResult', (p: { playerId: string; planResult?: { stockDCA?: { executed: boolean; amount: number; newPortfolioValue: number } } }) => {
      if (p.playerId !== s.id) {
        s.emit('planningDone');
      } else if (p.planResult?.stockDCA?.executed) {
        addNotification(`📈 發薪日定投 $${fmt(p.planResult.stockDCA.amount)}，股票組合總值 $${fmt(p.planResult.stockDCA.newPortfolioValue)}`);
      }
      setPaydayForm(null);
    });

    s.on('stockDCAResult', (p: { amount: number; newPortfolioValue: number; remainingCash: number }) => {
      addNotification(`📈 投入 $${fmt(p.amount)}，股票組合總值 $${fmt(p.newPortfolioValue)}`);
    });

    s.on('luckyCardDrawn', (p: { card: { title: string; description: string }; cashGain: number; newCash: number }) => {
      addNotification(`🍀 ${p.card.title}：+$${fmt(p.cashGain)}（${p.card.description}）`);
    });

    s.on('marketCardApplied', (p: { card: { title: string; effect: string }; dividendsPaid?: { playerId: string; playerName: string; cashGain: number }[] }) => {
      const myDiv = p.dividendsPaid?.find((d) => d.playerId === s.id);
      if (myDiv) {
        addNotification(`💰 市場配息「${p.card.title}」：+$${fmt(myDiv.cashGain)}`);
      } else if (p.card.effect === 'Dividend') {
        addNotification(`💼 ${p.card.title}（你目前沒有對應持倉，未領到配息）`);
      } else {
        addNotification(`📈 市場行情：${p.card.title}`);
      }
    });

    s.on('careerChangeUnlocked', (p: { message: string; availableProfessions: AvailableProfession[] }) => {
      setCareerChangeData(p);
      addNotification('🎯 技能值達到頂峰！現在可以轉職了，請在行動面板中選擇新職業。');
    });
    s.on('careerChangeResult', (p: { success: boolean; message: string; newProfession?: string; previousProfession?: string; salaryChange?: number }) => {
      if (p.success) {
        setCareerChangeCelebration({
          previousProfession: p.previousProfession ?? '',
          newProfession: p.newProfession ?? '',
          salaryChange: p.salaryChange,
        });
      } else {
        addNotification(`❌ 轉職失敗：${p.message}`);
      }
      setCareerChangeData(null);
    });
    s.on('careerChangeAnnouncement', (p: { playerName: string; previousProfession: string; newProfession: string }) => {
      addNotification(`🔄 ${p.playerName} 轉職：${p.previousProfession} → ${p.newProfession}！`);
    });
    s.on('milestoneAnnounced', (p: { playerName: string; milestone: string; description: string }) => {
      addNotification(`🏆 ${p.description}`);
    });

    // B1：人生夢想清單分配 / 達成
    s.on('bucketListAssigned', (p: { goals: { id: string; emoji: string; title: string; description: string }[] }) => {
      const list = p.goals.map((g) => `${g.emoji} ${g.title}`).join('、');
      addNotification(`🎯 進入外圈！抽到夢想清單：${list}`);
    });
    s.on('bucketGoalAchieved', (p: { playerId: string; playerName: string; goalEmoji: string; goalTitle: string; legacyReward: number; lifeExpReward: number; cashReward: number }) => {
      if (p.playerId === s.id) {
        const cash = p.cashReward > 0 ? `、+$${fmt(p.cashReward)}` : '';
        addNotification(`🎯 達成夢想 ${p.goalEmoji} ${p.goalTitle}！+傳承 ${p.legacyReward}、+體驗 ${p.lifeExpReward}${cash}`);
      } else {
        addNotification(`🎯 ${p.playerName} 達成「${p.goalEmoji} ${p.goalTitle}」！`);
      }
    });
    s.on('bucketListAllDone', (p: { playerId: string; playerName: string; bonus: { legacy: number; lifeExp: number; cash: number } }) => {
      if (p.playerId === s.id) {
        addNotification(`🌟 完成所有夢想！額外獎勵：傳承 +${p.bonus.legacy}、體驗 +${p.bonus.lifeExp}、現金 +$${fmt(p.bonus.cash)}`);
      } else {
        addNotification(`🌟 ${p.playerName} 完成全部人生夢想！`);
      }
    });

    // B2：人生里程碑（40/60/80 歲）
    s.on('lifeMilestoneReached', (p: { playerId: string; playerName: string; age: number; theme: string; emoji: string; legacyGain: number; lifeExpGain: number; cashGain: number }) => {
      if (p.playerId === s.id) {
        addNotification(`${p.emoji} ${p.age} 歲人生回顧：${p.theme}！+傳承 ${p.legacyGain}、+體驗 ${p.lifeExpGain}、+$${fmt(p.cashGain)}`);
      } else {
        addNotification(`${p.emoji} ${p.playerName} 跨越 ${p.age} 歲：${p.theme}！`);
      }
    });

    s.on('gameClock', (p: { currentAge: number }) => {
      setGameState((gs) => gs ? { ...gs, currentAge: p.currentAge } : gs);
    });

    return () => { s.disconnect(); };
  }, []);

  const emit = (event: string, ...args: unknown[]) => socketRef.current?.emit(event, ...args);

  function handleCardDecision(decision: Record<string, unknown>) {
    emit('submitCardDecision', decision);
    setActiveEvent(null);
  }

  function handlePaydaySubmit(plan: PaydayPlanPayload, lifeChoice: LifeChoice) {
    emit('submitPaydayPlan', plan);
    if (lifeChoice.type === 'travel') {
      emit('goTravel', { destinationId: (lifeChoice as { type: 'travel'; destinationId: string; destinationName: string }).destinationId });
    } else if (lifeChoice.type === 'social') {
      emit('attendSocialEvent');
    }
    setPaydayForm(null);
  }

  const myPlayer: Player | undefined = gameState?.players.find((p) => p.id === myId);
  const isMyTurn = gameState?.currentPlayerTurnId === myId;
  const isGameOver = gameState?.gamePhase === 'GameOver';

  // ── JOIN VIEW ──
  if (view === 'join') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card w-full max-w-sm space-y-4">
          <h1 className="text-2xl font-bold text-center text-emerald-400">百歲人生</h1>
          <p className="text-center text-gray-400 text-sm">輸入你的名字加入遊戲</p>

          {!connected && <p className="text-center text-yellow-400 text-sm">連線中…</p>}

          <input
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 text-lg"
            placeholder="你的名字"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            maxLength={12}
            autoFocus
          />

          {roomLocked && roomCode ? (
            <div className="flex items-center gap-2 bg-gray-800 border border-emerald-700 rounded-xl px-3 py-2">
              <span className="text-gray-400 text-sm">房間：</span>
              <span className="font-mono text-emerald-300 text-lg font-bold tracking-widest flex-1">{roomCode}</span>
              <button
                className="text-xs text-gray-500 hover:text-gray-300 underline"
                onClick={() => { setRoomCode(''); setRoomLocked(false); }}
              >
                更改
              </button>
            </div>
          ) : (
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white placeholder-gray-500 tracking-widest focus:outline-none focus:border-emerald-500"
              style={{ textTransform: 'uppercase' }}
              placeholder="房間代碼 (e.g. ABC123)"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={6}
            />
          )}

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            className="btn-primary w-full text-lg py-3"
            disabled={!connected || !playerName.trim() || roomCode.length < 4}
            onClick={() => {
              setError('');
              emit('playerJoin', { playerName: playerName.trim(), roomCode: roomCode.toUpperCase() });
              // 儲存到 localStorage，供斷線後重連使用
              localStorage.setItem('baisuiGame', JSON.stringify({ playerName: playerName.trim(), roomCode }));
            }}
          >
            加入遊戲
          </button>
        </div>
      </div>
    );
  }

  // ── PRE-20 VIEW ──
  if (view === 'pre20') {
    const totalAllocated = growthAlloc.academic + growthAlloc.health + growthAlloc.social + growthAlloc.resource;
    const remaining = (myPlayer?.growthPointsRemaining ?? 0) - totalAllocated;
    const hasContinuedEdu = myPlayer?.hasContinuedEducation ?? false;

    return (
      <div className="min-h-screen p-4 space-y-4 max-w-lg mx-auto">
        {/* 標題 */}
        <div className="card text-center">
          <h2 className="text-xl font-bold text-emerald-400">20 歲前的人生</h2>
          <p className="text-gray-400 text-sm mt-1">你的起點決定你的可能性</p>
        </div>

        {/* 步驟指示器（3 步驟） */}
        <div className="flex items-center justify-between px-1">
          {(['roll', 'allocate', 'career'] as const).map((step, i) => {
            const labels = ['投胎', '成長', '職業'];
            const stepOrder: Pre20Step[] = ['roll', 'allocate', 'career', 'done'];
            const currentIdx = stepOrder.indexOf(pre20Step);
            const isDone = currentIdx > i;
            const isCurrent = currentIdx === i;
            return (
              <div key={step} className="flex items-center flex-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${isDone ? 'bg-emerald-600 text-white' : isCurrent ? 'bg-emerald-400 text-black' : 'bg-gray-700 text-gray-500'}`}>
                  {isDone ? '✓' : i + 1}
                </div>
                <span className={`ml-1 text-xs ${isCurrent ? 'text-white' : 'text-gray-500'}`}>{labels[i]}</span>
                {i < 2 && <div className={`flex-1 h-0.5 mx-2 ${isDone ? 'bg-emerald-600' : 'bg-gray-700'}`} />}
              </div>
            );
          })}
        </div>

        {/* ── 步驟 1：投胎 ── */}
        {pre20Step === 'roll' && (
          <div className="card space-y-3">
            <p className="text-gray-300 text-sm">你即將隨機「投胎」成為四種社會階層之一，階層決定你的成長點數上限與起始資源。</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[['富裕階層', '多點數', 'text-yellow-300'], ['中上階層', '均衡', 'text-blue-300'], ['中等階層', '一般', 'text-gray-300'], ['小康/貧窮', '少點數', 'text-gray-500']].map(([name, desc, color]) => (
                <div key={name} className="bg-gray-800 rounded-lg p-2">
                  <p className={`font-bold ${color}`}>{name}</p>
                  <p className="text-gray-400">{desc}</p>
                </div>
              ))}
            </div>
            <button
              className="btn-primary w-full"
              onClick={() => { setError(''); emit('rollSocialClass'); }}
            >
              擲骰投胎
            </button>
          </div>
        )}

        {/* 階層已確定：顯示 */}
        {myPlayer?.socialClass && pre20Step !== 'roll' && (
          <div className="card flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400">社會階層</p>
              <p className="text-yellow-300 font-bold">{SOCIAL_CLASS_LABELS[myPlayer.socialClass] ?? myPlayer.socialClass}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">已分配 / 總點數</p>
              <p className="text-blue-300 font-bold">{totalAllocated} / {myPlayer.growthPointsRemaining}</p>
            </div>
          </div>
        )}

        {/* ── 步驟 2：分配成長屬性 ── */}
        {pre20Step === 'allocate' && myPlayer && (
          <div className="card space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-sm font-semibold text-white">分配成長點數</p>
              <span className={`text-sm font-bold ${remaining > 0 ? 'text-blue-300' : 'text-emerald-400'}`}>
                剩餘 {remaining} 點
              </span>
            </div>
            {GROWTH_FIELDS.map(({ key, label, desc }) => (
              <div key={key} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-300">{label}</span>
                  <span className="text-white font-bold">{growthAlloc[key]}</span>
                </div>
                <p className="text-xs text-gray-500">{desc}</p>
                <div className="flex items-center gap-2">
                  <button
                    className="w-8 h-8 bg-gray-700 hover:bg-gray-600 rounded-lg font-bold disabled:opacity-30 transition-colors"
                    disabled={growthAlloc[key] <= 0}
                    onClick={() => setGrowthAlloc((prev) => ({ ...prev, [key]: prev[key] - 1 }))}
                  >-</button>
                  <div className="flex-1 bg-gray-800 rounded-full h-2">
                    <div
                      className="bg-emerald-500 h-2 rounded-full transition-all"
                      style={{ width: `${myPlayer.growthPointsRemaining > 0 ? (growthAlloc[key] / myPlayer.growthPointsRemaining) * 100 : 0}%` }}
                    />
                  </div>
                  <button
                    className="w-8 h-8 bg-gray-700 hover:bg-gray-600 rounded-lg font-bold disabled:opacity-30 transition-colors"
                    disabled={remaining <= 0}
                    onClick={() => setGrowthAlloc((prev) => ({ ...prev, [key]: prev[key] + 1 }))}
                  >+</button>
                </div>
              </div>
            ))}
            <button
              className="btn-primary w-full"
              disabled={totalAllocated === 0}
              onClick={() => {
                setError('');
                emit('allocateGrowthStats', growthAlloc);
              }}
            >
              確認分配（已分配 {totalAllocated} 點）
            </button>
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          </div>
        )}

        {/* ── 步驟 3：職業選擇（E / S 象限） ── */}
        {pre20Step === 'career' && (
          <div className="space-y-3">
            {/* 警告橫幅 */}
            <div className="bg-orange-900 border border-orange-600 rounded-xl px-4 py-3 flex items-start gap-2">
              <span className="text-orange-400 text-xl leading-tight">⚠</span>
              <p className="text-orange-200 text-sm font-semibold">
                職業一旦確認無法更改，請仔細考慮是否先進修再選擇象限。
              </p>
            </div>

            {/* 進修卡片 */}
            <div className="card space-y-3">
              <p className="text-sm font-semibold text-white">繼續進修？</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-emerald-950 border border-emerald-800 rounded-lg p-2 space-y-1">
                  <p className="text-emerald-400 font-semibold">進修優點</p>
                  <p className="text-gray-300">解鎖高薪 E 職業（醫生、IT、店長、公職）</p>
                  <p className="text-gray-300">解鎖高階 S 職業（顧問、財務顧問等）</p>
                  <p className="text-gray-300">FQ 財商值提升</p>
                </div>
                <div className="bg-red-950 border border-red-800 rounded-lg p-2 space-y-1">
                  <p className="text-red-400 font-semibold">進修代價</p>
                  <p className="text-gray-300">$450,000 學貸（每月 -$9,000）</p>
                  <p className="text-gray-300">跳過第一個發薪日</p>
                </div>
              </div>
              {hasContinuedEdu ? (
                <div className="bg-emerald-950 border border-emerald-700 rounded-xl p-3 space-y-2">
                  <p className="text-emerald-300 font-bold text-sm">✓ 進修完成！你從 25 歲開始職涯</p>
                  <p className="text-xs text-gray-400">進修期間 22–25 歲，跳過第一個發薪日作為代價</p>
                  <div className="space-y-1 pt-2 border-t border-emerald-800/60">
                    <p className="text-xs text-white font-semibold">已解鎖高階職業（保證分配，不會抽到初階）：</p>
                    <div className="flex items-start gap-1.5">
                      <span className="text-xs font-bold bg-blue-700 text-white px-1.5 py-0.5 rounded-full flex-shrink-0">E</span>
                      <p className="text-xs text-blue-200">IT工程師、醫生、店長、公職人員</p>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-xs font-bold bg-purple-700 text-white px-1.5 py-0.5 rounded-full flex-shrink-0">S</span>
                      <p className="text-xs text-purple-200">顧問、財務顧問、心理諮商師、律師（獨立）</p>
                    </div>
                  </div>
                </div>
              ) : canEducation ? (
                <>
                  <button
                    className="w-full bg-blue-700 hover:bg-blue-600 text-white font-bold py-2 rounded-xl transition-colors"
                    onClick={() => { setError(''); emit('continueEducation'); }}
                  >
                    選擇進修（解鎖高階職業，25歲起）
                  </button>
                  <p className="text-xs text-gray-500 text-center">不進修則從 22 歲開始職涯（基礎職業）</p>
                </>
              ) : (
                <p className="text-gray-500 text-xs text-center">此角色資格不符，無法繼續進修，從 22 歲開始職涯</p>
              )}
            </div>

            {/* E 象限卡片 */}
            <div className="card space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold bg-blue-700 text-white px-2 py-0.5 rounded-full">E</span>
                <p className="text-sm font-semibold text-white">受薪族（Employee）</p>
              </div>
              <p className="text-xs text-gray-400">穩定固定薪資，時間受限（固定行程），每發薪日只能進行一次選擇性活動。</p>
              <p className="text-xs text-gray-500">職業由系統依象限隨機分配{hasContinuedEdu ? '（含高階職業：IT工程師、醫生、店長、公職）' : '（基礎職業）'}。</p>
              <button
                className="w-full bg-blue-800 hover:bg-blue-700 border border-blue-600 text-white font-bold py-2.5 rounded-xl transition-colors"
                onClick={() => { setError(''); emit('selectQuadrant', { quadrant: 'E' }); }}
              >
                選擇 E 象限，隨機分配職業
              </button>
            </div>

            {/* S 象限卡片 */}
            <div className="card space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold bg-purple-700 text-white px-2 py-0.5 rounded-full">S</span>
                <p className="text-sm font-semibold text-white">自僱者（Self-Employed）</p>
              </div>
              <p className="text-xs text-gray-400">自由行程，可無限進行旅遊與社交活動，但收入波動較大（依人脈、技能或隨機）。</p>
              <p className="text-xs text-gray-500">職業由系統依象限隨機分配{hasContinuedEdu ? '（含進階職業：顧問、財務顧問、心理諮商師）' : '（基礎＋中階職業）'}。</p>
              <button
                className="w-full bg-purple-800 hover:bg-purple-700 border border-purple-600 text-white font-bold py-2.5 rounded-xl transition-colors"
                onClick={() => { setError(''); emit('selectQuadrant', { quadrant: 'S' }); }}
              >
                選擇 S 象限，隨機分配職業
              </button>
            </div>

            {/* B 象限卡片（門檻：學識≥5 + 資源≥5）*/}
            {(() => {
              const ac = myPlayer?.growthStats?.academic ?? 0;
              const re = myPlayer?.growthStats?.resource ?? 0;
              const meetsB = ac >= 5 && re >= 5;
              return (
                <div className={`card space-y-2 ${meetsB ? '' : 'opacity-60'}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold bg-amber-700 text-white px-2 py-0.5 rounded-full">B</span>
                    <p className="text-sm font-semibold text-white">企業主（Business Owner）</p>
                  </div>
                  <p className="text-xs text-gray-400">起手即擁有事業資產與被動現金流。行程自由、薪資微薄，靠生意 cashflow 翻身。</p>
                  <p className="text-xs text-gray-500">職業：餐廳老闆 或 加盟主（隨機分配，自帶 $750K–$1.2M 事業）</p>
                  <p className={`text-xs font-semibold ${meetsB ? 'text-emerald-400' : 'text-red-400'}`}>
                    門檻：學識 ≥ 5 且 資源 ≥ 5（你目前 學識={ac}、資源={re}）
                  </p>
                  <button
                    className={`w-full font-bold py-2.5 rounded-xl transition-colors border ${
                      meetsB
                        ? 'bg-amber-800 hover:bg-amber-700 border-amber-600 text-white'
                        : 'bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed'
                    }`}
                    disabled={!meetsB}
                    onClick={() => { if (meetsB) { setError(''); emit('selectQuadrant', { quadrant: 'B' }); } }}
                  >
                    {meetsB ? '選擇 B 象限，隨機分配企業' : '門檻不足，無法選 B'}
                  </button>
                </div>
              );
            })()}

            {/* I 象限卡片（門檻：學識≥7 + 資源≥7）*/}
            {(() => {
              const ac = myPlayer?.growthStats?.academic ?? 0;
              const re = myPlayer?.growthStats?.resource ?? 0;
              const meetsI = ac >= 7 && re >= 7;
              return (
                <div className={`card space-y-2 ${meetsI ? '' : 'opacity-60'}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold bg-emerald-700 text-white px-2 py-0.5 rounded-full">I</span>
                    <p className="text-sm font-semibold text-white">投資者（Investor）</p>
                  </div>
                  <p className="text-xs text-gray-400">天使投資人：起始 FQ=5、$450K 股票投組、$7,500/月配息。月支出極低，最快達 FastTrack。</p>
                  <p className="text-xs text-gray-500">起始現金僅 $3,000（資金已投入市場）</p>
                  <p className={`text-xs font-semibold ${meetsI ? 'text-emerald-400' : 'text-red-400'}`}>
                    門檻：學識 ≥ 7 且 資源 ≥ 7（你目前 學識={ac}、資源={re}）
                  </p>
                  <button
                    className={`w-full font-bold py-2.5 rounded-xl transition-colors border ${
                      meetsI
                        ? 'bg-emerald-800 hover:bg-emerald-700 border-emerald-600 text-white'
                        : 'bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed'
                    }`}
                    disabled={!meetsI}
                    onClick={() => { if (meetsI) { setError(''); emit('selectQuadrant', { quadrant: 'I' }); } }}
                  >
                    {meetsI ? '選擇 I 象限，成為天使投資人' : '門檻不足，無法選 I'}
                  </button>
                </div>
              );
            })()}

            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          </div>
        )}

        {/* ── 步驟完成：等待遊戲開始 ── */}
        {pre20Step === 'done' && myPlayer && (
          <div className="card text-center space-y-2">
            <p className="text-2xl">🎉</p>
            <p className="text-emerald-400 font-bold text-lg">設定完成！</p>
            <p className="text-gray-300 text-sm">{myPlayer.profession.name}（{myPlayer.profession.quadrant} 象限）</p>
            <p className="text-gray-400 text-xs">等待主持人啟動遊戲…</p>
          </div>
        )}

        {/* ── 互動彈出卡片 ── */}
        {congratulatableEvent && (
          <div className="card border border-yellow-600 bg-yellow-900 space-y-2">
            <p className="text-yellow-200 font-semibold text-sm">🎉 {congratulatableEvent.targetName} {congratulatableEvent.event}！</p>
            <p className="text-yellow-400 text-xs">花費 $7,500 送上祝賀（對方 +$7,500，NT+0.2）</p>
            <div className="flex gap-2">
              <button className="btn-primary text-sm flex-1" onClick={() => {
                emit('congratulate', { targetPlayerId: congratulatableEvent.targetId, event: congratulatableEvent.event });
                setCongratulatableEvent(null);
              }}>🎊 恭喜（$7,500）</button>
              <button className="btn-secondary text-sm" onClick={() => setCongratulatableEvent(null)}>略過</button>
            </div>
          </div>
        )}

        {activeAuction && (
          <div className="card border border-blue-600 bg-blue-900 space-y-2">
            <p className="text-blue-200 font-semibold text-sm">🔔 {activeAuction.triggeredByName} 放棄交易，開放競標！</p>
            {activeAuction.card && (
              <div className="bg-blue-950 rounded-lg px-3 py-2 text-xs space-y-0.5">
                <p className="text-blue-100 font-semibold">{activeAuction.card.name}</p>
                {activeAuction.card.monthlyCashflow !== undefined && (
                  <p className="text-emerald-400">月現金流 +${(activeAuction.card.monthlyCashflow ?? 0).toLocaleString()}</p>
                )}
                <p className="text-blue-300">起標金額：<span className="text-yellow-300 font-bold">${activeAuction.minBid.toLocaleString()}</span></p>
              </div>
            )}
            {activeAuction.highestBid > 0 && (
              <p className="text-xs text-blue-300">目前最高標：<span className="text-yellow-300 font-bold">${activeAuction.highestBid.toLocaleString()}</span>（{activeAuction.highestBidderName}）</p>
            )}
            <div className="flex gap-2">
              <input
                type="number"
                value={auctionBid}
                onChange={(e) => setAuctionBid(e.target.value)}
                placeholder={`起標 $${activeAuction.minBid.toLocaleString()}`}
                className="input-field flex-1 text-sm"
              />
              <button className="btn-primary text-sm" onClick={() => {
                emit('bidDeal', { auctionId: activeAuction.auctionId, bidAmount: Number(auctionBid) });
                setAuctionBid('');
              }}>出價</button>
              <button className="btn-secondary text-sm" onClick={() => setActiveAuction(null)}>略過</button>
            </div>
          </div>
        )}

        {partnershipOffer && (
          <div className="card border border-green-600 bg-green-900 space-y-2">
            <p className="text-green-200 font-semibold text-sm">🤝 {partnershipOffer.offerorName} 邀請你合夥！</p>
            <p className="text-green-400 text-xs">雙方各獲得 +15 生命體驗值</p>
            <div className="flex gap-2">
              <button className="btn-primary text-sm flex-1" onClick={() => {
                emit('partnershipResponse', { offerId: partnershipOffer.offerId, accepted: true });
                setPartnershipOffer(null);
              }}>✅ 接受合夥</button>
              <button className="btn-secondary text-sm" onClick={() => {
                emit('partnershipResponse', { offerId: partnershipOffer.offerId, accepted: false });
                setPartnershipOffer(null);
              }}>❌ 拒絕</button>
            </div>
          </div>
        )}

        {loanOffer && (
          <div className="card border border-purple-600 bg-purple-900 space-y-2">
            <p className="text-purple-200 font-semibold text-sm">💳 {loanOffer.lenderName} 願意借你 ${loanOffer.amount.toLocaleString()}</p>
            <p className="text-purple-400 text-xs">月息 {(loanOffer.monthlyRate * 100).toFixed(1)}%（每月支出增加 ${Math.round(loanOffer.amount * loanOffer.monthlyRate).toLocaleString()}）</p>
            <div className="flex gap-2">
              <button className="btn-primary text-sm flex-1" onClick={() => {
                emit('loanResponse', { offerId: loanOffer.offerId, accepted: true });
                setLoanOffer(null);
              }}>✅ 借款</button>
              <button className="btn-secondary text-sm" onClick={() => {
                emit('loanResponse', { offerId: loanOffer.offerId, accepted: false });
                setLoanOffer(null);
              }}>❌ 拒絕</button>
            </div>
          </div>
        )}

        {loanRequest && (
          <div className="card border border-amber-600 bg-amber-900 space-y-2">
            <p className="text-amber-200 font-semibold text-sm">💸 {loanRequest.borrowerName} 向你請求借款 ${loanRequest.amount.toLocaleString()}</p>
            <p className="text-amber-400 text-xs">月息 {(loanRequest.monthlyRate * 100).toFixed(1)}%（對方每月還你 ${Math.round(loanRequest.amount * loanRequest.monthlyRate).toLocaleString()}）</p>
            <p className="text-amber-300 text-xs">同意後將從你的現金扣 ${loanRequest.amount.toLocaleString()}，並把該金額轉給對方。</p>
            <div className="flex gap-2">
              <button className="btn-primary text-sm flex-1" onClick={() => {
                emit('loanRequestResponse', { requestId: loanRequest.requestId, accepted: true });
                setLoanRequest(null);
              }}>✅ 同意借出</button>
              <button className="btn-secondary text-sm" onClick={() => {
                emit('loanRequestResponse', { requestId: loanRequest.requestId, accepted: false });
                setLoanRequest(null);
              }}>❌ 拒絕</button>
            </div>
          </div>
        )}

        {/* 通知 */}
        {notifications.length > 0 && (
          <div className="card space-y-1">
            {notifications.map((n, i) => (
              <p key={i} className="text-sm text-gray-300">{n}</p>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── GAME VIEW ──
  if ((view === 'game' || view === 'gameover') && myPlayer && gameState) {
    // 找到目前格子（快車道時用 fastTrackPosition，內圈時用 currentPosition）
    const isOnFastTrack = !!myPlayer.isInFastTrack;
    const trackConfig = isOnFastTrack ? outerCircleConfig : innerCircleConfig;
    const rawPos = isOnFastTrack
      ? (myPlayer.fastTrackPosition ?? 0)
      : (myPlayer.currentPosition ?? 0);
    const pos = trackConfig.length > 0 ? rawPos % trackConfig.length : 0;
    const cellConfig = trackConfig[pos];

    // 顯示用年齡：優先取後端算好的 personalAge；舊版 server 退回前端計算
    const personalAge =
      myPlayer.personalAge ?? Math.max(myPlayer.startAge ?? 20, gameState.currentAge);

    // 計算通知數量
    const notifCount = notifications.length;

    return (
      <div className="min-h-screen bg-gray-900 flex flex-col max-w-lg mx-auto relative">

        {/* ── 擲骰動畫 overlay（自己擲骰時播放） ── */}
        {diceAnim && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
            <DiceRollOverlay data={diceAnim} onDone={() => setDiceAnim(null)} size="small" />
          </div>
        )}

        {/* ── 發薪日全螢幕表單（最高層） ── */}
        {paydayForm && myPlayer && (
          <PaydayPlanForm
            data={paydayForm}
            playerCash={myPlayer.cash}
            onSubmit={handlePaydaySubmit}
          />
        )}

        {/* ── 轉職成功慶祝彈窗 ── */}
        {careerChangeCelebration && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-gradient-to-b from-yellow-950 to-gray-900 border-2 border-yellow-500 rounded-2xl px-8 py-10 text-center max-w-sm w-full shadow-2xl space-y-4">
              <div className="text-6xl">🎯</div>
              <h2 className="text-2xl font-black text-yellow-300">恭喜轉職成功！</h2>
              <div className="space-y-2">
                <p className="text-gray-400 text-sm">從</p>
                <p className="text-white font-semibold text-lg">「{careerChangeCelebration.previousProfession}」</p>
                <p className="text-gray-400 text-sm">轉職為</p>
                <p className="text-yellow-300 font-black text-2xl">「{careerChangeCelebration.newProfession}」</p>
              </div>
              {careerChangeCelebration.salaryChange != null && (
                <p className={`text-lg font-bold ${careerChangeCelebration.salaryChange >= 0 ? 'text-emerald-400' : 'text-orange-400'}`}>
                  月薪{careerChangeCelebration.salaryChange >= 0 ? '增加' : '變動'} ${Math.abs(careerChangeCelebration.salaryChange).toLocaleString()}
                </p>
              )}
              <button
                className="mt-4 w-full bg-yellow-600 hover:bg-yellow-500 text-white font-bold py-3 rounded-xl text-lg transition-colors"
                onClick={() => setCareerChangeCelebration(null)}
              >
                太棒了！繼續前進 🚀
              </button>
            </div>
          </div>
        )}

        {/* ── TopBar ── */}
        <div className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-white font-bold text-sm truncate">{myPlayer.name}</div>
            <div className="text-gray-400 text-xs truncate">{myPlayer.profession.name}
              {myPlayer.isInFastTrack && <span className="ml-1 text-yellow-400">★ FastTrack</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <button
              className="text-xs px-2 py-1 rounded-lg bg-emerald-900/60 hover:bg-emerald-900 border border-emerald-700 text-emerald-300 transition-colors"
              onClick={() => setShowIntro(true)}
            >
              策略指南
            </button>
            <div className="text-right">
              <div className="text-yellow-300 font-bold text-sm">
                {personalAge.toFixed(1)} 歲
              </div>
              {gameState.isPaused && <div className="text-orange-400 text-xs">⏸ 暫停</div>}
              <div className={`text-xs font-bold ${myPlayer.monthlyCashflow >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {myPlayer.monthlyCashflow >= 0 ? '+' : ''}${fmt(myPlayer.monthlyCashflow)}/月
              </div>
            </div>
          </div>
        </div>

        {/* ── 主要捲動區 ── */}
        <div className="flex-1 overflow-y-auto">

          {/* 目前格子大圖 */}
          {!isGameOver && cellConfig && (
            <div className="mx-4 mt-4 mb-2 rounded-2xl border border-gray-700 bg-gray-800 p-4 text-center">
              <div className="text-5xl mb-2">{cellConfig.icon}</div>
              <div className="text-white font-bold text-lg">{cellConfig.name}</div>
              <div className="text-gray-400 text-xs mt-0.5">
                {isOnFastTrack ? '外圈' : '內圈'} 第 {pos + 1} 格 / 共 {trackConfig.length} 格
              </div>
              {cellConfig.description && (
                <div className="mt-2 text-xs text-emerald-300 bg-emerald-950/50 rounded-xl px-3 py-2 text-left">
                  {cellConfig.description}
                </div>
              )}
            </div>
          )}

          {/* 事件卡（有事件時取代格子顯示，或加在下面） */}
          {activeEvent && (
            <div className="mx-4 mb-3">
              <EventCard
                event={activeEvent}
                onDecision={handleCardDecision}
                onDismiss={() => setActiveEvent(null)}
              />
            </div>
          )}

          {/* 擲骰區 */}
          {!isGameOver && (
            <div className="mx-4 mb-3">
              <DiceRoller
                isMyTurn={isMyTurn}
                isBedridden={myPlayer.isBedridden}
                onRoll={(count) => { setRollingLocked(true); emit('playerRoll', { diceCount: count }); }}
                lastRoll={lastRoll}
                disabled={rollingLocked}
              />
            </div>
          )}

          {/* 幸福指數提示 */}
          {!isGameOver && (() => {
            const cf = myPlayer.monthlyCashflow;
            const exp = myPlayer.totalExpenses;
            const hp = myPlayer.stats.health;
            const nt = myPlayer.stats.network;
            const travels = myPlayer.visitedDestinations?.length ?? 0;
            let hint = '';
            let hintColor = 'text-emerald-300';
            if (hp < 40) { hint = '❤️ 健康警告！少旅遊多休養，維護生命體驗指數'; hintColor = 'text-red-400'; }
            else if (cf < 0) { hint = '📉 現金流為負，賣掉負現金流資產讓錢幫你工作'; hintColor = 'text-red-400'; }
            else if (!myPlayer.isMarried && nt < 3) { hint = '🤝 NT 人脈偏低，多社交事件可提升人際關係指數'; hintColor = 'text-pink-400'; }
            else if (cf < 7_500) { hint = '💡 持續投資小交易，增加被動收入'; hintColor = 'text-yellow-400'; }
            else if (travels < 3) { hint = '✈️ 多出去走走！旅遊可提升生命體驗指數'; hintColor = 'text-teal-400'; }
            else if (cf >= exp && !myPlayer.isInFastTrack) { hint = '🚀 被動收入已超越支出，快準備脫出老鼠賽跑！'; hintColor = 'text-emerald-400'; }
            return hint ? (
              <div className={`mx-4 text-xs px-3 py-2 rounded-xl bg-gray-800 border border-gray-700 mb-2 ${hintColor}`}>{hint}</div>
            ) : null;
          })()}

          {/* 遊戲結束橫幅 */}
          {isGameOver && (
            <div className="mx-4 mt-4 rounded-xl bg-purple-900 border border-purple-700 p-4 text-center">
              <p className="text-purple-200 font-bold text-lg mb-2">遊戲結束！</p>
              <button className="btn-primary text-sm w-full" onClick={() => { setView('analysis'); emit('requestPlayerAnalysis'); }}>
                查看我的人生分析
              </button>
            </div>
          )}

          {/* B1：人生夢想清單 / B2：里程碑 / A1：慈善累積 */}
          {!isGameOver && (myPlayer.isInFastTrack || (myPlayer.charityTotal ?? 0) > 0) && (
            <div className="mx-4 mb-2 rounded-2xl border border-purple-800 bg-purple-950/50 p-3">
              <div className="text-purple-200 font-bold text-sm mb-2 flex items-center justify-between">
                <span>🌟 人生成就</span>
                {(myPlayer.charityTotal ?? 0) > 0 && (
                  <span className="text-pink-300 text-xs font-normal">
                    ❤️ 累積慈善 ${fmt(myPlayer.charityTotal ?? 0)}
                  </span>
                )}
              </div>

              {/* 里程碑進度 */}
              {(() => {
                const passed = myPlayer.milestonesPassed ?? { age40: false, age60: false, age80: false };
                const ages: { key: 'age40' | 'age60' | 'age80'; emoji: string; age: number }[] = [
                  { key: 'age40', emoji: '🌱', age: 40 },
                  { key: 'age60', emoji: '🍂', age: 60 },
                  { key: 'age80', emoji: '🌟', age: 80 },
                ];
                return (
                  <div className="flex gap-2 mb-2">
                    {ages.map((m) => {
                      const done = passed[m.key];
                      const reached = personalAge >= m.age;
                      return (
                        <div key={m.key}
                          className={`flex-1 text-center text-xs px-2 py-1 rounded-lg border ${done ? 'bg-yellow-900/40 border-yellow-700 text-yellow-300' : reached ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
                          <div className="text-base">{m.emoji}</div>
                          <div className="font-bold">{m.age} 歲</div>
                          <div className="text-[10px]">{done ? '已通過' : reached ? '處理中' : '未到'}</div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* 夢想清單 */}
              {myPlayer.isInFastTrack && (myPlayer.bucketList?.length ?? 0) > 0 && (
                <div className="space-y-1">
                  <div className="text-purple-300 text-xs">🎯 人生夢想清單</div>
                  {(myPlayer.bucketList ?? []).map((entry) => {
                    const meta = BUCKET_GOAL_LABELS[entry.id];
                    if (!meta) return null;
                    return (
                      <div key={entry.id}
                        className={`flex items-center gap-2 px-2 py-1 rounded-lg text-xs ${entry.claimed ? 'bg-emerald-900/40 border border-emerald-700' : 'bg-gray-800 border border-gray-700'}`}>
                        <span className="text-base">{meta.emoji}</span>
                        <span className={`flex-1 ${entry.claimed ? 'text-emerald-200 line-through' : 'text-gray-200'}`}>
                          <span className="font-bold">{meta.title}</span>
                          <span className="ml-1 text-gray-400">— {meta.desc}</span>
                        </span>
                        {entry.claimed && <span className="text-emerald-300">✓</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── 可展開面板 ── */}
          <div className="mt-2">
            <CollapsePanel title="財務報表" badge={myPlayer.monthlyCashflow < 0 ? '!' : undefined}>
              <FinancialStatement player={myPlayer} />
            </CollapsePanel>

            <CollapsePanel title="行動" defaultOpen={false}>
              <ActionPanel
                player={myPlayer}
                currentAge={personalAge}
                otherPlayers={gameState.players.filter((p) => p.id !== myId && p.isAlive).map((p) => ({ id: p.id, name: p.name }))}
                onTravel={(destId) => emit('goTravel', { destinationId: destId })}
                onSocialEvent={() => emit('attendSocialEvent')}
                onBuyInsurance={(t) => emit('buyInsurance', { insuranceType: t })}
                onTakeEmergencyLoan={(amt) => emit('takeEmergencyLoan', { amount: amt })}
                onTakeLeverageLoan={(amt, name) => emit('takeLeverageLoan', { amount: amt, targetAssetName: name })}
                onInvestStockDCA={(amt) => emit('investStockDCA', { amount: amt })}
                onLoanOffer={(targetId, amount, monthlyRate) => emit('loanOffer', { targetPlayerId: targetId, amount, monthlyRate })}
                onLoanRequest={(targetId, amount, monthlyRate) => emit('loanRequest', { targetPlayerId: targetId, amount, monthlyRate })}
                onSellAsset={(assetId) => emit('sellAsset', { assetId })}
                onRequestAnalysis={() => { emit('requestPlayerAnalysis'); }}
                isGameOver={isGameOver}
                careerChangeData={careerChangeData}
                onCareerChange={(professionId) => emit('requestCareerChange', { newProfessionId: professionId })}
              />
            </CollapsePanel>

            <CollapsePanel title="通知" badge={notifCount > 0 ? notifCount : undefined} defaultOpen={false}>
              {notifications.length > 0 ? (
                <div className="space-y-1">
                  {notifications.map((n, i) => (
                    <p key={i} className="text-xs text-gray-300">{n}</p>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500">目前沒有通知</p>
              )}
            </CollapsePanel>
          </div>

          {/* 互動彈出卡片（合夥、借貸、恭喜、競標）移至通知面板以外的懸浮層 */}
          {congratulatableEvent && (
            <div className="mx-4 my-2 rounded-xl border border-yellow-600 bg-yellow-900 p-3 space-y-2">
              <p className="text-yellow-200 font-semibold text-sm">🎉 {congratulatableEvent.targetName} {congratulatableEvent.event}！</p>
              <p className="text-yellow-400 text-xs">花費 $7,500 送上祝賀（對方 +$7,500，NT+0.2）</p>
              <div className="flex gap-2">
                <button className="btn-primary text-sm flex-1" onClick={() => { emit('congratulate', { targetPlayerId: congratulatableEvent.targetId, event: congratulatableEvent.event }); setCongratulatableEvent(null); }}>🎊 恭喜（$7,500）</button>
                <button className="btn-secondary text-sm" onClick={() => setCongratulatableEvent(null)}>略過</button>
              </div>
            </div>
          )}
          {activeAuction && (
            <div className="mx-4 my-2 rounded-xl border border-blue-600 bg-blue-900 p-3 space-y-2">
              <p className="text-blue-200 font-semibold text-sm">🔔 {activeAuction.triggeredByName} 放棄交易，開放競標！</p>
              {activeAuction.card && (
                <div className="bg-blue-950 rounded-lg px-2 py-1 text-xs flex justify-between">
                  <span className="text-blue-100">{activeAuction.card.name}</span>
                  <span className="text-yellow-300">起標 ${activeAuction.minBid.toLocaleString()}</span>
                </div>
              )}
              {activeAuction.highestBid > 0 && (
                <p className="text-xs text-blue-300">最高標 <span className="text-yellow-300 font-bold">${activeAuction.highestBid.toLocaleString()}</span>（{activeAuction.highestBidderName}）</p>
              )}
              <div className="flex gap-2">
                <input type="number" value={auctionBid} onChange={(e) => setAuctionBid(e.target.value)} placeholder={`起標 $${activeAuction.minBid.toLocaleString()}`} className="input-field flex-1 text-sm" />
                <button className="btn-primary text-sm" onClick={() => { emit('bidDeal', { auctionId: activeAuction.auctionId, bidAmount: Number(auctionBid) }); setAuctionBid(''); }}>出價</button>
                <button className="btn-secondary text-sm" onClick={() => setActiveAuction(null)}>略過</button>
              </div>
            </div>
          )}
          {partnershipOffer && (
            <div className="mx-4 my-2 rounded-xl border border-green-600 bg-green-900 p-3 space-y-2">
              <p className="text-green-200 font-semibold text-sm">🤝 {partnershipOffer.offerorName} 邀請你合夥！</p>
              <p className="text-green-300 text-xs">合作成功雙方各得 +15 體驗值，並依雙方被動收入總和獲得 3% 一次性分紅。</p>
              <div className="flex gap-2">
                <button className="btn-primary text-sm flex-1" onClick={() => { emit('partnershipResponse', { offerId: partnershipOffer.offerId, accepted: true }); setPartnershipOffer(null); }}>✅ 接受</button>
                <button className="btn-secondary text-sm" onClick={() => { emit('partnershipResponse', { offerId: partnershipOffer.offerId, accepted: false }); setPartnershipOffer(null); }}>❌ 拒絕</button>
              </div>
            </div>
          )}
          {partnershipChoice && (
            <div className="mx-4 my-2 rounded-xl border border-emerald-600 bg-emerald-900 p-3 space-y-2">
              <p className="text-emerald-200 font-semibold text-sm">🤝 合夥機會！選擇一位夥伴發起邀請</p>
              <p className="text-emerald-300 text-xs">合作成功雙方各得 +15 體驗值 + 雙方被動收入 × 3% 分紅（$3K-$50K）</p>
              <div className="flex flex-wrap gap-2">
                {partnershipChoice.availablePartners.map((partner) => (
                  <button
                    key={partner.id}
                    className="btn-primary text-sm flex-1 min-w-[40%]"
                    onClick={() => {
                      emit('partnershipOffer', { targetPlayerId: partner.id });
                      setPartnershipChoice(null);
                    }}
                  >
                    邀請 {partner.name}
                  </button>
                ))}
                <button
                  className="btn-secondary text-sm w-full"
                  onClick={() => setPartnershipChoice(null)}
                >
                  略過
                </button>
              </div>
            </div>
          )}
          {loanOffer && (
            <div className="mx-4 my-2 rounded-xl border border-purple-600 bg-purple-900 p-3 space-y-2">
              <p className="text-purple-200 font-semibold text-sm">💳 {loanOffer.lenderName} 願意借你 ${fmt(loanOffer.amount)}</p>
              <p className="text-purple-400 text-xs">月息 {(loanOffer.monthlyRate * 100).toFixed(1)}%</p>
              <div className="flex gap-2">
                <button className="btn-primary text-sm flex-1" onClick={() => { emit('loanResponse', { offerId: loanOffer.offerId, accepted: true }); setLoanOffer(null); }}>✅ 借款</button>
                <button className="btn-secondary text-sm" onClick={() => { emit('loanResponse', { offerId: loanOffer.offerId, accepted: false }); setLoanOffer(null); }}>❌ 拒絕</button>
              </div>
            </div>
          )}
          {loanRequest && (
            <div className="mx-4 my-2 rounded-xl border border-amber-600 bg-amber-900 p-3 space-y-2">
              <p className="text-amber-200 font-semibold text-sm">💸 {loanRequest.borrowerName} 向你請求借款 ${fmt(loanRequest.amount)}</p>
              <p className="text-amber-400 text-xs">月息 {(loanRequest.monthlyRate * 100).toFixed(1)}%（對方每月還你 ${fmt(Math.round(loanRequest.amount * loanRequest.monthlyRate))}）</p>
              <div className="flex gap-2">
                <button className="btn-primary text-sm flex-1" onClick={() => { emit('loanRequestResponse', { requestId: loanRequest.requestId, accepted: true }); setLoanRequest(null); }}>✅ 同意借出</button>
                <button className="btn-secondary text-sm" onClick={() => { emit('loanRequestResponse', { requestId: loanRequest.requestId, accepted: false }); setLoanRequest(null); }}>❌ 拒絕</button>
              </div>
            </div>
          )}

          <div className="h-4" /> {/* 底部空間 */}

          {/* 大型年齡提示（底部裝飾性數字） */}
          <div className="flex items-end justify-center pb-8 pt-2 select-none pointer-events-none gap-1">
            <span className="text-9xl font-black tabular-nums leading-none"
              style={{ color: 'rgba(253,224,71,0.12)' }}>
              {Math.floor(personalAge)}
            </span>
            <span className="text-2xl font-bold pb-3"
              style={{ color: 'rgba(253,224,71,0.12)' }}>
              歲
            </span>
          </div>
        </div>

        {/* 策略指南 bottom sheet */}
        {showIntro && (
          <div className="fixed inset-0 z-50 flex flex-col justify-end">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowIntro(false)} />
            <div className="relative bg-gray-950 rounded-t-2xl border-t border-gray-700 h-[85vh] flex flex-col">
              <IntroSheet onClose={() => setShowIntro(false)} mode="sheet" />
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── ANALYSIS VIEW ──
  if (view === 'analysis' && analysis) {
    return (
      <div className="min-h-screen p-3 max-w-lg mx-auto">
        <button className="btn-secondary text-sm mb-3" onClick={() => setView(isGameOver ? 'gameover' : 'game')}>
          ← 返回
        </button>
        <AnalysisPage analysis={analysis} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center text-gray-400">
      載入中…
    </div>
  );
}

