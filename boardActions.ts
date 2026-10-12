import type { Socket } from 'socket.io';
import type { GameState, Player } from './gameDataModels';
import { INNER_NODES, OUTER_NODES } from './frontend/src/boardLayout';
import { chooseBoardAction, BoardChoice } from './boardJourney';
import { buyInsurance, cancelInsurance, attendSocialEvent, goTravel, travelLeaveCost, sellAsset } from './gameLogic';
import { repayRoomLoan } from './playerLoans';
import { investBondFund, currentBondRate } from './bondFund';
import { BASIC_INVESTMENTS, buyBasicInvestment } from './basicInvestments';
import { buyHome, getHomeOffers } from './householdLoans';
import { buyCar, getCarOffers } from './cars';
import { mentorBlockReason, mentorPlayer } from './lateLife';
import { LIFESTYLE_OPTIONS, HEALTH_HABIT_OPTIONS, HP_MAINTENANCE_COST, NETWORK_INVEST_COST, FERTILITY_COST, ADOPTION_COST, SOCIAL_EVENT_COST, SOCIAL_EVENT_DRS_MIN, SOCIAL_EVENT_DRS_MAX, SOCIAL_EVENT_DRS_PEAK_MAX, LIFE_EVENT_WINDOWS, DIVORCE_LEGAL_FEE, DIVORCE_CASH_SHARE, DIVORCE_HP_COST } from './gameConfig';
import { applyHPChange, getFQUpgradeCost, applyPaydayPlan } from './statsSystem';
import { TRAVEL_DESTINATIONS, HP_BOOST_COST, HP_BOOST_AMOUNT, SKILL_TRAINING_COST, SKILL_TRAINING_GAIN, INSURANCE_ACTIVATION_FEE, MEDICAL_INSURANCE_PREMIUM, LIFE_INSURANCE_PREMIUM, PROPERTY_INSURANCE_PREMIUM, STOCK_DCA_MONTHLY_DIVIDEND_RATE, STOCK_DCA_MONTHLY_RETURN_RATE } from './gameConfig';
import { fileDivorce, divorceBlock, addFamilyTies, adoptChild, adoptionBlock, tryForBaby, fertilityBlock, fertilityChance } from './family';
import { emitCellEvent, logPlayerEvent, calcNetWorth, announceCareerUnlock } from './socketServer';

const money = (n: number) => '$' + Math.round(n).toLocaleString('zh-TW');
type Action = BoardChoice & { run: () => string };
const skip: Action = { id: 'skip', label: '這次不安排', description: '不扣款，保留目前狀態。', run: () => '這次不安排，沒有扣款。' };
function pay(p: Player, cost: number, run: () => void, result: string): string {
  if (p.cash < cost) return '現金不足，未執行、未扣款。';
  p.cash -= cost; run(); return result;
}
function health(p: Player): Action {
  const cost = HP_BOOST_COST + HP_MAINTENANCE_COST * 2;
  return { id: 'health', group: '健康與學習', label: '健康照顧', description: `${money(cost)}，HP +${HP_BOOST_AMOUNT}（上限 100），維護三輪。`, disabled: p.cash < cost,
    run: () => pay(p, cost, () => { applyHPChange(p, HP_BOOST_AMOUNT); p.healthMaintenanceRounds = 3; }, '健康照顧完成，維護涵蓋接下來三輪。') };
}
function training(p: Player): Action[] {
  const fq = getFQUpgradeCost(p.stats.financialIQ);
  return [
    { id: 'skill', label: '職涯技能培訓', description: `${money(SKILL_TRAINING_COST)}，SK +${SKILL_TRAINING_GAIN}（上限 100）。`, disabled: p.cash < SKILL_TRAINING_COST || p.stats.careerSkill >= 100,
      run: () => p.stats.careerSkill >= 100 ? '技能已滿級，未扣款。' : pay(p, SKILL_TRAINING_COST, () => { p.stats.careerSkill = Math.min(100, p.stats.careerSkill + SKILL_TRAINING_GAIN); }, '完成職涯技能培訓。') },
    { id: 'fq', label: '財商學習', description: fq === null ? '財商已滿級。' : `${money(fq)}，FQ 提升一級。`, disabled: fq === null || p.cash < fq,
      run: () => fq === null || getFQUpgradeCost(p.stats.financialIQ) !== fq ? '財商資格或費用已變更，未執行、未扣款。' : pay(p, fq, () => { p.stats.financialIQ = Math.min(10, p.stats.financialIQ + 1); }, '完成財商學習。') },
  ];
}
function familyOptions(gs: GameState, p: Player): { title: string; description: string; options: Action[] } {
  const stories = ['care', 'finance', ...(p.isMarried ? ['relationship'] : []), ...(p.numberOfChildren ? ['child'] : []), 'balance', 'growth'];
  const story = stories[(p.familyStoryCursor ?? 0) % stories.length];
  p.familyStoryCursor = (p.familyStoryCursor ?? 0) + 1;
  const option = (id: string, label: string, cost: number, hp: number, ties: number, experience: number, desc: string): Action => ({
    id, label, description: `${money(cost)}；HP ${hp >= 0 ? '+' : ''}${hp}、家庭連結 +${ties}、體驗 +${experience}。${desc}`, disabled: p.cash < cost,
    run: () => pay(p, cost, () => { applyHPChange(p, hp); addFamilyTies(p, ties); p.lifeExperience += experience; }, label + '。' + desc),
  });
  let title = '', description = '', options: Action[] = [];
  if (story === 'care') {
    title = '家中長輩需要照護'; description = '父母或重要長輩生病，你如何安排照護？各種分工都有價值。';
    options = [option('personal','親自照護',15000,-8,10,5,'投入時間與體力。'), option('professional','聘請專業照護',60000,0,6,3,'支付這次照護費用，不新增永久月費。'), option('share','與親友協調分工',25000,-3,8,4,'分攤照護與溝通工作。')];
  } else if (story === 'relationship') {
    title = '新的心動與現有關係'; description = '你遇到一位讓你重新思考婚姻的人。新關係未必是答案，你想如何面對？';
    options = [option('boundary','維持界線，保留婚姻',0,0,0,3,'不新增關係承諾。'), option('repair','投入伴侶溝通',20000,3,8,4,'嘗試修復，不保證所有問題消失。'),
      { id:'divorce',label:'結束目前婚姻',description:`法律費 ${money(DIVORCE_LEGAL_FEE)}，另分出剩餘現金的 ${DIVORCE_CASH_SHARE*100}%，HP −${DIVORCE_HP_COST}；配偶收支停止、子女保留，不自動再婚。`,disabled:!!divorceBlock(p),run:()=>divorceBlock(p) ?? fileDivorce(p) }];
  } else if (story === 'child') {
    title = '孩子選擇不同的道路'; description = '孩子希望追求與你期待不同的學習或職涯方向。';
    options = [option('fund','提供資金支持',45000,0,8,5,'給予探索機會。'), option('listen','陪伴討論與訂計畫',10000,-3,10,5,'投入心力，設定可承擔的範圍。'), option('limit','有限支持並約定界線',15000,0,5,4,'一起釐清責任。')];
  } else if (story === 'finance') {
    title = '親友希望你支持創業'; description = '這是家庭支持，不是保證回本的投資。';
    options = [option('support','提供一次性資助',40000,0,10,5,'資助不列為可回收資產。'), option('limited','有限資助',15000,0,5,3,'保留較多自用資金。'), option('advice','不出資，協助整理計畫',0,-3,3,3,'投入心力而非資金。')];
  } else if (story === 'growth') {
    title = '家庭的下一個階段'; description = '選擇是否新增家庭成員，或把心力留給現有關係。';
    options = [
      {id:'baby',label:'嘗試求子',description:fertilityBlock(gs,p) ?? `費用 ${money(FERTILITY_COST)}，成功率 ${Math.round(fertilityChance(gs,p)*100)}%，不成功亦不退費；成功後新增子女支出。`,disabled:!!fertilityBlock(gs,p),run:()=>fertilityBlock(gs,p) ?? tryForBaby(gs,p).message},
      {id:'adopt',label:'申請領養',description:adoptionBlock(gs,p) ?? `費用 ${money(ADOPTION_COST)}，新增一位子女及相應支出。`,disabled:!!adoptionBlock(gs,p),run:()=>adoptionBlock(gs,p) ?? adoptChild(gs,p)},
      option('care','陪伴現有家人或重要他人',10000,2,5,4,'不新增子女。'),
    ];
  } else {
    title = '家庭陪伴與個人計畫'; description = '重要的人希望你多留一些時間，但你也有自己的計畫。';
    options = [option('together','安排共同生活體驗',25000,4,8,8,'花費由你承擔。'), option('coordinate','協商各自與共同的時間',5000,0,5,5,'保留自己的計畫，也安排陪伴。'), option('space','先照顧自己的需要',10000,8,0,4,'暫時保留距離，不扣道德分。')];
  }
  options.push({id:'neutral',label:'換成一般關係情境',description:'改為協調朋友或團隊的時間，不需分享私事。費用 $10,000、HP −2、關係 +4、體驗 +3。',disabled:p.cash<10000,run:()=>pay(p,10000,()=>{applyHPChange(p,-2);p.relationshipPoints+=4;p.lifeExperience+=3;},'以一般關係協調完成此事件。')});
  return { title, description, options };
}

/** Returns true when the new board handler owns the square. Legacy investment/crisis code stays reusable. */
export async function handleBoardAction(socket: Socket, gs: GameState, p: Player): Promise<boolean> {
  const node = (p.isInFastTrack ? OUTER_NODES : INNER_NODES)[p.isInFastTrack ? p.fastTrackPosition : p.currentPosition];
  const kind: string = node[1];
  if (['deal','market','expense','crisis','charity','second'].includes(kind)) return false;
  let title: string = node[0], description = '請本人選擇；送出後由主持人揭曉。';
  let options: Action[] = [];
  if (kind === 'start' || kind === 'fork') {
    emitCellEvent(socket,gs.gameId,p.name,title,kind==='fork' ? `已選擇${p.boardDirection==='life'?'生活':'事業'}方向，下次沿此路線前進。` : '新的旅程開始。本格不另行發薪。'); return true;
  }
  if (kind === 'family') ({title,description,options} = familyOptions(gs,p));
  else if (kind === 'health') options = [health(p)];
  else if (kind === 'training' || kind === 'career') {
    options = training(p);
    description = kind === 'career' ? '可先提升技能；SK 達 100 後可在手機申請轉職，由主持人安排轉職舞台。' : '這次選擇一項學習，不同能力影響往後的機會。';
  } else if (kind === 'travel' || kind === 'experience' || kind === 'dream') {
    options = TRAVEL_DESTINATIONS.filter(d => p.isInFastTrack || d.tier !== 'outer').map(d => {
      const cost = d.cost + travelLeaveCost(p,d);
      return { id:d.id,label:d.name,description:`旅費及請假共 ${money(cost)}，體驗 +${p.visitedDestinations.includes(d.id)?Math.floor(d.lifeExpGained/2):d.lifeExpGained}，HP 消耗 ${d.hpCost}。${Object.entries(d.statEffect??{}).map(([k,v])=>`${k.toUpperCase()} +${v}`).join('、')}`,disabled:p.cash<cost || p.stats.health<50,
        run:()=>{p.actionTokensThisPayday=1;const r=goTravel(p,d.id);return r.success?`前往「${d.name}」，實際體驗 +${r.lifeExperienceGained}。`:r.message ?? '旅遊未執行。';}};
    });
  } else if (kind === 'service') {
    options = [health(p),...training(p).map(o=>({...o,group:'健康與學習'}))];
    for (const [type,key,label,premium] of [['medical','hasMedicalInsurance','醫療險',MEDICAL_INSURANCE_PREMIUM],['life','hasLifeInsurance','壽險',LIFE_INSURANCE_PREMIUM],['property','hasPropertyInsurance','財產險',PROPERTY_INSURANCE_PREMIUM]] as const) {
      const owned=p.insurance[key];
      options.push({id:type,group:'保險',label:(owned?'解除':'投保')+label,description:owned?'不退費，停止保費並失去保障。':`啟動費 ${money(INSURANCE_ACTIVATION_FEE[type])}，月保費 ${money(premium)}。`,disabled:!owned&&p.cash<INSURANCE_ACTIVATION_FEE[type],run:()=>{if(owned){cancelInsurance(p,type);return '已解除'+label+'，沒有退費。';}const r=buyInsurance(p,type);return r.success?'已投保'+label:r.message??'投保未執行。';}});
    }
    options.push(...management(gs,p));
  } else if (kind === 'assets') {
    options=management(gs,p);
  } else if (kind === 'legacy') {
    options=[...gs.players.values()].filter(target=>target.id!==p.id&&target.isAlive).map(target=>({
      id:target.id,label:'指導 '+target.name,description:'對方 SK +10、體驗 +3；自己傳承 +5、體驗 +5，並增加家庭連結。每輪最多一次。',disabled:!!mentorBlockReason(gs,p,target),
      run:()=>{const blocked=mentorBlockReason(gs,p,target);if(blocked)return blocked;const cash=target.cash,flow=target.monthlyCashflow,worth=calcNetWorth(target);const result=mentorPlayer(gs,p,target);logPlayerEvent(target,gs,'mentor',result,cash,flow,worth,{mentorId:p.id});return result;},
    }));
  } else if (kind === 'social' && !p.isMarried) {
    const w=LIFE_EVENT_WINDOWS.marriage;
    const max=p.currentAge>=w.peakStart&&p.currentAge<=w.peakEnd?SOCIAL_EVENT_DRS_PEAK_MAX:SOCIAL_EVENT_DRS_MAX;
    options=[{id:'social',label:'參加相親聯誼',description:`費用 ${money(SOCIAL_EVENT_COST)}，關係 +${SOCIAL_EVENT_DRS_MIN}～${max}，不保證結婚。`,disabled:p.cash<SOCIAL_EVENT_COST||p.stats.health<40,run:()=>{p.actionTokensThisPayday=1;const r=attendSocialEvent(p,p.currentAge);return r.message ?? (r.success?'聯誼完成。':'聯誼未執行。');}}];
  } else {
    // Repair, mentorship and cooperation offer a time/health vs cash choice, not free repeated bonuses.
    options=[{id:'time',label:kind==='legacy'?'投入指導與陪伴':'投入時間協調',description:`HP −5，關係 +8、體驗 +5${kind==='legacy'?'、傳承 +5':''}。`,disabled:p.stats.health<10,run:()=>{applyHPChange(p,-5);p.relationshipPoints+=8;p.lifeExperience+=5;if(kind==='legacy')p.legacyBonusPoints+=5;return '已投入陪伴與協調。';}},
      {id:'resource',label:'投入資源共同安排',description:'支付 $25,000，關係 +5、體驗 +5。',disabled:p.cash<25000,run:()=>pay(p,25000,()=>{p.relationshipPoints+=5;p.lifeExperience+=5;},'完成共同安排。')}];
  }
  options.push(skip);
  const selected = await chooseBoardAction(socket,gs,p,title,description,options);
  const action = options.find(o=>o.id===selected&&!o.disabled) ?? skip;
  const cash=p.cash,flow=p.monthlyCashflow,worth=calcNetWorth(p);
  if (!p.isAlive) return true;
  const result=action.run();
  logPlayerEvent(p,gs,kind==='travel'?'travel':'relationship',`${title}：${action.label}。${result}`,cash,flow,worth,{boardAction:kind,choice:action.id});
  emitCellEvent(socket,gs.gameId,p.name,title,result);
  announceCareerUnlock(gs,p);
  return true;
}

function management(gs: GameState, p: Player): Action[] {
  const actions: Action[] = [
    {id:'network',group:'健康與學習',label:'拓展人脈',description:`${money(NETWORK_INVEST_COST)}，NT +1。`,disabled:p.cash<NETWORK_INVEST_COST||(p.profession.salaryType!=='nt_driven'&&p.stats.network>=10),run:()=>pay(p,NETWORK_INVEST_COST,()=>{p.stats.network=Math.min(p.profession.salaryType==='nt_driven'?Infinity:10,p.stats.network+1);},'完成人脈經營。')},
    ...p.assets.filter(a=>!a.id.startsWith('p2p-')).map(a=>({id:'sell:'+a.id,group:'資產與還款',label:'出售 '+a.name,description:`估值 ${money(a.currentValue??a.cost)}，結清關聯貸款，獲利另扣稅。`,run:()=>{const r=sellAsset(p,a.id);return r.message??(r.success?`出售完成，現金變化 ${money(r.netCashChange??0)}`:'未出售。');}})),
    ...p.liabilities.map(l=>({id:'repay:'+l.id,group:'資產與還款',label:'提前償還 '+l.name,description:`最多償還 ${money(Math.min(l.totalDebt,p.cash))}；不超過餘額及現金。`,disabled:p.cash<=0,run:()=>{const r=repayRoomLoan(gs.players.values(),p,l.id,l.totalDebt);return r.message??'還款完成。';}})),
    ...[50000,200000].map(amount=>({id:'bond:'+amount,group:'投資',label:`債券 ${money(amount)}`,description:`目前年殖利率 ${(currentBondRate(gs)*100).toFixed(1)}%，每月配息約 ${money(amount*currentBondRate(gs)/12)}，利率會變動。`,disabled:p.cash<amount,run:()=>investBondFund(p,amount,currentBondRate(gs)).message})),
    ...[30000,150000].map(amount=>({id:'stock:'+amount,group:'投資',label:`股票基金 ${money(amount)}`,description:`模擬每月增值 ${(STOCK_DCA_MONTHLY_RETURN_RATE*100).toFixed(2)}%、配息 ${(STOCK_DCA_MONTHLY_DIVIDEND_RATE*100).toFixed(2)}%；受行情事件影響。`,disabled:p.cash<amount,run:()=>{
      const result=applyPaydayPlan(p,{stockDCAAmount:amount,investInFQUpgrade:false,investInHealthMaintenance:false,investInHealthBoost:false,investInSkillTraining:false,investInNetwork:false,buyInsuranceTypes:[]});const asset=p.assets.find(a=>a.id==='stock-dca');
      if(asset)asset.monthlyCashflow=Math.round(asset.currentValue*STOCK_DCA_MONTHLY_DIVIDEND_RATE);
      return result.stockDCA.executed?`投入股票基金 ${money(amount)}。`:'現金不足，未執行。';
    }})),
    ...BASIC_INVESTMENTS.map(b=>({id:b.id,group:'投資',label:b.name,description:`${money(b.cost)}／份；${b.description}`,disabled:p.cash<b.cost,run:()=>buyBasicInvestment(p,b.id,gs.turnNumber+1).message})),
    ...getHomeOffers(p).map(o=>({id:'home:'+o.id,group:'住宅與交通',label:'購買 '+o.name,description:`頭期款及稅費 ${money(o.cashNeeded)}；月房貸 ${money(o.monthlyPayment)}，原房租停止。`,disabled:!o.affordable,run:()=>buyHome(p,o.id).message})),
    ...getCarOffers(p).flatMap(o=>[false,true].map(payCash=>({id:`car:${o.id}:${payCash}`,group:'住宅與交通',label:`${o.name}（${payCash?'現金':'貸款'}）`,description:`支付 ${money(payCash?o.price:o.downPayment)}；每月養車${payCash?'':'及貸款'} ${money(payCash?o.runningCost:o.monthlyWithLoan)}，取代交通費 ${money(o.transitSaved)}。`,disabled:payCash?!o.canCash:!o.canLoan,run:()=>buyCar(p,o.id,payCash).message}))),
  ];
  for (const key of Object.keys(LIFESTYLE_OPTIONS) as Player['lifestyle'][]) { const o=LIFESTYLE_OPTIONS[key]; actions.push({id:'life:'+key,group:'生活設定',label:o.label+'生活',description:o.desc,disabled:p.lifestyle===key,run:()=>{p.lifestyle=key;return '生活方式改為'+o.label+'。'+o.desc;}}); }
  for (const key of Object.keys(HEALTH_HABIT_OPTIONS) as Player['healthHabit'][]) { const o=HEALTH_HABIT_OPTIONS[key]; actions.push({id:'habit:'+key,group:'生活設定',label:o.label,description:o.desc,disabled:p.healthHabit===key,run:()=>{p.healthHabit=key;return '健康習慣改為'+o.label+'。'+o.desc;}}); }
  return actions;
}
