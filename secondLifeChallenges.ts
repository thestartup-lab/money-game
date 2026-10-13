import type { Player } from './gameDataModels';
import type { BoardChoice } from './boardJourney';
import { applyHPChange } from './statsSystem';

type Challenge = {
  id: string; title: string; story: string; cost: number; hp: number;
  experience: number; relationship: number; skill: number; legacy: number;
  chance?: number; crisis?: boolean;
};
export const SECOND_LIFE_CHALLENGES: readonly Challenge[] = [
  { id:'apprentice', title:'重新當一次學徒', story:'放下原本的資歷，跟年輕師傅學一項陌生技術。', cost:30000,hp:6,experience:14,relationship:4,skill:12,legacy:0 },
  { id:'remote-service', title:'走進陌生社區', story:'離開熟悉的生活環境，參與異地服務，先聽見當地人的需要。', cost:60000,hp:10,experience:18,relationship:10,skill:0,legacy:8 },
  { id:'failure-story', title:'公開分享自己的失敗', story:'整理一次挫折並公開分享，接受提問；只需角色作決定，不要求學員透露私事。', cost:15000,hp:5,experience:12,relationship:8,skill:0,legacy:10 },
  { id:'cross-generation', title:'跨世代共同創作', story:'不再由你指揮，與不同世代共同完成作品。合作可能不如預期，仍有學習。', cost:80000,hp:8,experience:16,relationship:12,skill:6,legacy:8,chance:0.65 },
  { id:'new-city', title:'在陌生城市重新生活', story:'暫時離開熟悉圈子，練習語言、建立新關係；不是單純觀光。', cost:120000,hp:12,experience:24,relationship:10,skill:6,legacy:0 },
  { id:'community-project', title:'第一次發起公共提案', story:'投入資源改善社區，公開接受不同意見。提案不保證獲支持，資金不是可回收投資。', cost:100000,hp:8,experience:18,relationship:10,skill:0,legacy:16,chance:0.55 },
  { id:'rebuild', title:'熟悉的計畫被迫中止', story:'原本倚賴的團隊解散。你願意重新召集夥伴，從小規模再開始嗎？', cost:70000,hp:8,experience:18,relationship:12,skill:4,legacy:6,chance:0.6,crisis:true },
  { id:'listen', title:'面對被你忽略的聲音', story:'長期合作的人提出不同意見。你願意離開主導位置，投入一次由對方帶領的修復工作嗎？', cost:20000,hp:6,experience:14,relationship:14,skill:0,legacy:8,crisis:true },
];

/** Draw once per landing; the resulting choices survive reconnect via privateReplay. */
const domains: Record<string, 'explore'|'connect'|'contribute'> = {
  apprentice:'explore', 'remote-service':'contribute', 'failure-story':'contribute',
  'cross-generation':'connect', 'new-city':'explore', 'community-project':'contribute', rebuild:'explore', listen:'connect',
};
export function chooseSecondLifeChallengeId(p: Player, crisis = false): string {
  const pool = SECOND_LIFE_CHALLENGES.filter(c => Boolean(c.crisis) === crisis);
  const history = p.secondLifeChallengeHistory ?? [];
  const practices = p.secondLifeJourney?.practices ?? [];
  const fresh = pool.filter(c => !practices.some(x => x.id === c.id));
  const missing = fresh.filter(c => !practices.some(x => x.domain === domains[c.id]));
  const eligible = missing.length ? missing : fresh.length ? fresh : pool;
  const unseen = eligible.filter(c => !history.includes(c.id));
  const nonrepeat = eligible.filter(c => c.id !== history[history.length-1]);
  const choices = unseen.length ? unseen : nonrepeat.length ? nonrepeat : eligible;
  const card = choices[Math.floor(Math.random() * choices.length)];
  p.secondLifeChallengeHistory = [...history.slice(-30), card.id];
  return card.id;
}
export function drawSecondLifeChallenge(p: Player, crisis = false) {
  return buildSecondLifeChallenge(p, chooseSecondLifeChallengeId(p, crisis));
}
export function buildSecondLifeChallenge(p: Player, id: string): {
  title: string; description: string; options: (BoardChoice & { run: () => string })[];
} {
  const card = SECOND_LIFE_CHALLENGES.find(c => c.id === id)!;
  let executed = false;
  const make = (small: boolean, time = false) => {
    const scale = time ? 0.25 : small ? 0.5 : 1;
    const cost = time ? 0 : Math.round(card.cost * scale), hp = time ? card.hp + 3 : Math.ceil(card.hp * scale);
    const exp = Math.floor(card.experience * scale), relationship = Math.floor(card.relationship * scale);
    const skill = Math.floor(card.skill * scale), legacy = Math.floor(card.legacy * scale);
    const chance = small || time ? 1 : (card.chance ?? 1);
    const label = time ? '投入時間與體力' : small ? '先做小規模嘗試' : '投入完整挑戰';
    const repeated = () => Boolean(p.secondLifeJourney?.practices.some(x => x.id === card.id));
    return {
      id: time ? 'challenge-time' : small ? 'challenge-small' : 'challenge-full', label,
      description: `費用 $${cost.toLocaleString()}，HP −${hp}。${chance < 1 ? `達成率 ${Math.round(chance*100)}%；達成時` : '完成後'}體驗 +${exp}、關係 +${relationship}、SK +${skill}（上限 100）、傳承 +${legacy}。${chance < 1 ? `未達成仍付全額及體力，僅體驗 +${Math.floor(exp/3)}；其他獎勵不發。` : ''}`,
      disabled: repeated() || p.cash < cost || p.stats.health - hp < 20 || p.isBedridden,
      run: () => {
        if (executed || repeated()) return '此挑戰已實踐，不重複領獎，未扣款。';
        if (!p.isAlive || p.cash < cost || p.stats.health - hp < 20 || p.isBedridden) return '目前資金或健康不足，未執行、未扣款。';
        executed = true;
        p.cash -= cost; applyHPChange(p, -hp);
        const success = Math.random() < chance;
        p.secondLifeJourney?.practices.push({id:card.id,domain:domains[card.id],mode:label,success});
        p.lifeExperience += success ? exp : Math.floor(exp/3);
        if (success) { p.relationshipPoints += relationship; p.stats.careerSkill = Math.min(100,p.stats.careerSkill+skill); p.legacyBonusPoints += legacy; }
        return `${card.title}：${label}${success ? '完成' : '未達預期，保留學習體驗'}。支付 $${cost.toLocaleString()}，HP −${hp}；體驗 +${success ? exp : Math.floor(exp/3)}、關係 +${success ? relationship : 0}、SK +${success ? skill : 0}（上限 100）、傳承 +${success ? legacy : 0}。已留下實踐紀錄。`;
      },
    };
  };
  return { title:card.title, description:card.story+' 可以嘗試、縮小規模、投入時間或婉拒；拒絕不扣分，也不需要說明私事。同一挑戰只計一次實踐與獎勵。', options:[make(false),make(true),make(false,true)] };
}
