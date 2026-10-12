const test = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { io } = require('socket.io-client');
const { INNER_NODES, OUTER_NODES, nextInnerNode } = require('../dist/frontend/src/boardLayout');

function wait(socket, event, predicate = () => true) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.off(event,listener);reject(Error('Timeout '+event));},5000);
    const listener=data=>{if(predicate(data)){clearTimeout(timer);socket.off(event,listener);resolve(data);}};
    socket.on(event,listener);
  });
}
function send(s,event,payload,response,predicate){const promise=wait(s,response,predicate);s.emit(event,payload);return promise;}

test('新版 PNG 節點：分支等長，匯合點正確，24 與 17 格座標皆有效',()=>{
  assert.equal(INNER_NODES.length,24);assert.equal(OUTER_NODES.length,17);
  for(const nodes of [INNER_NODES,OUTER_NODES])for(const [, ,x,y]of nodes){assert.ok(x>0&&x<100);assert.ok(y>0&&y<100);}
  for(const direction of ['career','life']){
    let p=0,path=[];do{p=nextInnerNode(p,direction);path.push(p);}while(p!==0&&path.length<30);
    assert.equal(path.length,18);assert.equal(new Set(path).size,18);assert.ok(path.includes(23));
    assert.equal(path.includes(4),direction==='career');assert.equal(path.includes(7),direction==='life');
  }
  assert.equal(nextInnerNode(6),10);assert.equal(nextInnerNode(9),10);
  assert.equal(nextInnerNode(16),20);assert.equal(nextInnerNode(19),20);
});

test('新版手機→主持人→結果：旅遊、分岔、重連、服務站、同步退休、連續資格', {timeout:45000}, async t=>{
  const server=fork(require.resolve('./helpers/board-v6-server.cjs'),[],{env:{...process.env,PORT:'3396',NODE_ENV:'test'},silent:true});
  let errors='';server.stderr.on('data',d=>errors+=d);
  const sockets=[];t.after(()=>{sockets.forEach(s=>s.disconnect());server.kill();});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(errors||'boot timeout')),5000);server.on('message',m=>{if(m.ready){clearTimeout(timer);resolve();}});});
  const command=(action,extra={})=>new Promise((resolve,reject)=>{const request=Math.random().toString();const timer=setTimeout(()=>reject(Error('IPC '+action)),5000);const listener=m=>{if(m.request===request){clearTimeout(timer);server.off('message',listener);m.error?reject(Error(m.error)):resolve(m.result);}};server.on('message',listener);server.send({request,action,...extra});});
  const connect=async()=>{const s=io('http://127.0.0.1:3396',{transports:['websocket'],reconnection:false});sockets.push(s);await wait(s,'connect');return s;};
  const host=await connect(),a=await connect(),b=await connect(),display=await connect();
  const room=await send(host,'createRoom',{roomId:'BOARD6'},'roomCreated');
  const sa=await send(a,'playerJoin',{roomCode:room.roomId,playerName:'甲'},'playerSession');
  const sb=await send(b,'playerJoin',{roomCode:room.roomId,playerName:'乙'},'playerSession');
  await send(display,'joinDisplay',{roomId:room.roomId},'gameStateUpdate');
  let latest;host.on('gameStateUpdate',g=>latest=g);
  const started=await send(host,'startGame',{force:true},'gameStateUpdate',g=>g.gamePhase==='RatRace');
  assert.equal(started.boardJourneyEnabled,true);assert.equal(started.actionPhaseEnabled,false);assert.equal(started.paydayTimer.enabled,false);
  assert.equal(started.decisionPhase,null);
  await command('position',{id:sa.playerId,position:3,direction:'life'});
  const rolled=wait(display,'playerRolled');
  const reading=await send(a,'playerRoll',{diceCount:1},'gameStateUpdate',g=>g.decisionPhase?.kind==='reading');
  assert.equal((await rolled).oldPosition,3);assert.match(reading.decisionPhase.title,/出國旅遊/);
  const prompt=wait(a,'boardChoiceRequired');
  await send(host,'continueDecisionPhase',{phaseId:reading.decisionPhase.id},'gameStateUpdate',g=>g.decisionPhase?.kind==='relationship');
  const travel=await prompt;const phase=latest.decisionPhase.id;
  const cash=latest.players.find(p=>p.id===sa.playerId).cash;
  assert.ok(travel.options.some(o=>o.id==='skip'));
  await send(host,'continueDecisionPhase',{phaseId:phase},'error');
  await send(a,'submitCardDecision',{phaseId:phase,choiceId:'forged'},'error');
  assert.equal(latest.decisionPhase.submitted,false);
  a.disconnect();const resumed=await connect();const replay=wait(resumed,'boardChoiceRequired');
  await send(resumed,'playerRejoin',{roomCode:room.roomId,playerName:'甲',reconnectToken:sa.reconnectToken},'rejoinSuccess');
  assert.deepEqual((await replay).options,travel.options);
  await send(resumed,'submitCardDecision',{phaseId:phase,choiceId:'skip'},'decisionSubmitted');
  assert.equal(latest.players.find(p=>p.id===sa.playerId).cash,cash,'送出未揭曉不扣款');
  const unchanged=await send(host,'continueDecisionPhase',{phaseId:phase},'gameStateUpdate',g=>g.decisionPhase?.kind==='reading');
  assert.equal(unchanged.players.find(p=>p.id===sa.playerId).cash,cash);
  assert.match(unchanged.decisionPhase.description,/沒有扣款/);
  await send(host,'continueDecisionPhase',{phaseId:unchanged.decisionPhase.id},'gameStateUpdate',g=>!g.turnInProgress&&!g.decisionPhase);

  // A route choice cannot silently default or be submitted by another player.
  await command('position',{id:sb.playerId,position:2});
  const forkPrompt=wait(b,'boardChoiceRequired');b.emit('playerRoll',{diceCount:1});await forkPrompt;
  await send(resumed,'submitCardDecision',{phaseId:latest.decisionPhase.id,choiceId:'career'},'error');
  await send(b,'submitCardDecision',{phaseId:latest.decisionPhase.id,choiceId:'life'},'decisionSubmitted');
  const forkRead=await send(host,'continueDecisionPhase',{phaseId:latest.decisionPhase.id},'gameStateUpdate',g=>g.decisionPhase?.kind==='reading');
  let nextRead=await send(host,'continueDecisionPhase',{phaseId:forkRead.decisionPhase.id},'gameStateUpdate',g=>g.decisionPhase?.kind==='reading'&&g.decisionPhase.id!==forkRead.decisionPhase.id);
  await send(host,'continueDecisionPhase',{phaseId:nextRead.decisionPhase.id},'gameStateUpdate',g=>g.decisionPhase?.settlement);
  await send(host,'continueDecisionPhase',{phaseId:latest.decisionPhase.id},'gameStateUpdate',g=>!g.decisionPhase&&!g.turnInProgress);

  // Buy insurance via service, not the removed free-action menu. Duplicate submit applies once.
  await command('position',{id:sa.playerId,position:9});
  const serviceRead=await send(resumed,'playerRoll',{diceCount:1},'gameStateUpdate',g=>g.decisionPhase?.kind==='reading');
  const servicePrompt=wait(resumed,'boardChoiceRequired');
  await send(host,'continueDecisionPhase',{phaseId:serviceRead.decisionPhase.id},'gameStateUpdate',g=>g.decisionPhase?.kind==='relationship');
  const service=await servicePrompt;assert.ok(service.options.some(o=>o.group==='生活設定'));
  const phase2=latest.decisionPhase.id;const before=latest.players.find(p=>p.id===sa.playerId);
  await send(resumed,'submitCardDecision',{phaseId:phase2,choiceId:'medical'},'decisionSubmitted');
  resumed.emit('submitCardDecision',{phaseId:phase2,choiceId:'medical'});
  const result=await send(host,'continueDecisionPhase',{phaseId:phase2},'gameStateUpdate',g=>g.decisionPhase?.kind==='reading');
  const after=result.players.find(p=>p.id===sa.playerId);
  assert.equal(after.insurance.hasMedicalInsurance,true);assert.equal(before.cash-after.cash,require('../dist/gameConfig').INSURANCE_ACTIVATION_FEE.medical);
  assert.match(result.decisionPhase.description,/月支出/);
  await send(host,'continueDecisionPhase',{phaseId:result.decisionPhase.id},'gameStateUpdate',g=>!g.decisionPhase&&!g.turnInProgress);

  // Both players choose together; no retirement takes effect before host reveal.
  const retireState=wait(host,'gameStateUpdate',g=>g.facilitatorScene?.kind==='retirement');await command('retirement');
  const scene=(await retireState).facilitatorScene;assert.equal(scene.retirementParticipants.length,2);
  await send(host,'resolveFacilitatorScene',{sceneId:scene.id,choiceId:'reveal'},'error');
  await send(resumed,'chooseRetirement',{sceneId:scene.id,choice:'retire'},'gameStateUpdate',g=>g.facilitatorScene?.retirementParticipants[0].confirmed);
  assert.equal(latest.players.find(p=>p.id===sa.playerId).retirementStatus,'working');assert.equal(latest.facilitatorScene.careerConfirmed,false);
  await send(resumed,'chooseRetirement',{sceneId:scene.id,choice:'consultant'},'error');
  await send(b,'chooseRetirement',{sceneId:scene.id,choice:'consultant'},'gameStateUpdate',g=>g.facilitatorScene?.careerConfirmed);
  const retired=await send(host,'resolveFacilitatorScene',{sceneId:scene.id,choiceId:'reveal'},'gameStateUpdate',g=>g.facilitatorScene?.stage==='result');
  assert.equal(retired.players.find(p=>p.id===sa.playerId).retirementStatus,'retired');assert.equal(retired.players.find(p=>p.id===sb.playerId).retirementStatus,'consultant');
  await send(host,'resolveFacilitatorScene',{sceneId:scene.id,choiceId:'reveal'},'error');
  await send(host,'closeFacilitatorScene',{sceneId:scene.id},'gameStateUpdate',g=>!g.facilitatorScene);
  const qualification=await command('qualification',{id:sa.playerId});
  assert.equal(qualification.first,false);assert.equal(qualification.second,true);assert.equal(qualification.revoked,false);
  assert.equal(qualification.afterFirst,1);assert.equal(qualification.repeated,1);assert.equal(qualification.afterSecond,2);assert.equal(qualification.reset,0);assert.equal(qualification.cycles,1);
  await command('seedRestart');
  await send(host,'restartGame',{},'gameStateUpdate',g=>g.gamePhase==='Pre20');
  assert.deepEqual(await command('auditRestart'),{paid:0,community:0,history:[],action:-1,retirement:[]});
  assert.equal(errors.trim(),'');
});

test('新版整場三人：落格決策、共同結算、同步退休到終局，不再出現每輪行動選单', {timeout:60000}, async t=>{
  const server=fork(require.resolve('./helpers/board-v6-server.cjs'),[],{env:{...process.env,PORT:'3397',NODE_ENV:'test'},silent:true});
  let errors='';server.stderr.on('data',d=>errors+=d);const sockets=[];
  t.after(()=>{sockets.forEach(s=>s.disconnect());server.kill();});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(errors||'boot timeout')),5000);server.on('message',m=>{if(m.ready){clearTimeout(timer);resolve();}});});
  const connect=async()=>{const s=io('http://127.0.0.1:3397',{transports:['websocket'],reconnection:false});sockets.push(s);await wait(s,'connect');return s;};
  const host=await connect(),players=[await connect(),await connect(),await connect()];
  const room=await send(host,'createRoom',{roomId:'WHOLE6'},'roomCreated');const ids=[];
  for(const [i,p]of players.entries())ids.push((await send(p,'playerJoin',{roomCode:room.roomId,playerName:'玩家'+i},'playerSession')).playerId);
  let latest,rolledKey='',settlements=0,choices=0,maxRetirementCohort=0;
  const clientErrors=[];for(const socket of [host,...players])socket.on('error',e=>{clientErrors.push(e.message);if(e.message.includes('主持人控制流程'))rolledKey='';});
  const tryRoll=()=>{
    const g=latest;if(!g||!['RatRace','FastTrack'].includes(g.gamePhase))return;
    const key=`${g.turnNumber}:${g.currentPlayerTurnId}`;
    if(!g.decisionPhase&&!g.facilitatorScene&&!g.turnInProgress&&!g.isPaused&&!g.globalPaydayPending&&!g.globalPaydayInProgress&&key!==rolledKey){rolledKey=key;players[ids.indexOf(g.currentPlayerTurnId)]?.emit('playerRoll',{diceCount:2});}
  };
  const rollTimer=setInterval(tryRoll,50);t.after(()=>clearInterval(rollTimer));
  const handled=new Set();
  host.on('gameStateUpdate',g=>{
    latest=g;const phase=g.decisionPhase,scene=g.facilitatorScene;
    assert.ok(!phase||!['actions','payday'].includes(phase.kind),'新版不得重開全體行動或人生規劃');
    if(phase&&(phase.kind==='reading'||phase.kind==='auction'||phase.submitted)&&!handled.has(phase.id)){
      handled.add(phase.id);
      if(phase.settlement){settlements++;for(const p of phase.settlement.payouts)assert.equal(Object.values(p.ledger).reduce((a,b)=>a+b,0),p.total);}
      host.emit('continueDecisionPhase',{phaseId:phase.id});
    }
    if(scene){
      if(scene.stage==='result'){host.emit('closeFacilitatorScene',{sceneId:scene.id});return;}
      if(scene.kind==='retirement'){
        maxRetirementCohort=Math.max(maxRetirementCohort,scene.retirementParticipants.length);
        for(const p of scene.retirementParticipants)if(!p.confirmed)players[ids.indexOf(p.playerId)].emit('chooseRetirement',{sceneId:scene.id,choice:'retire'});
        if(scene.careerConfirmed)host.emit('resolveFacilitatorScene',{sceneId:scene.id,choiceId:'reveal'});
      } else if(scene.kind==='marriage'){
        if(scene.careerConfirmed)host.emit('resolveFacilitatorScene',{sceneId:scene.id,choiceId:'reveal'});
        else players[ids.indexOf(scene.careerPlayerId)]?.emit('answerMarriage',{sceneId:scene.id,accept:false});
      } else if(scene.kind==='community')host.emit('resolveFacilitatorScene',{sceneId:scene.id,choiceId:'majority'});
      else if(scene.options[0])host.emit('resolveFacilitatorScene',{sceneId:scene.id,choiceId:scene.options[0].id});
    }
  });
  for(const p of players){
    let localState; p.on('gameStateUpdate',g=>localState=g);
    const answer=decision=>p.emit('submitCardDecision',{phaseId:localState.decisionPhase.id,...decision});
    p.on('boardChoiceRequired',data=>{
      choices++;const choice=data.options.find(o=>o.id==='life'&&!o.disabled)??data.options.find(o=>o.id==='health'&&!o.disabled)??data.options.find(o=>!o.disabled&&o.id!=='skip');
      answer({choiceId:choice?.id??'skip'});
    });
    p.on('dealCardsDrawn',data=>{const card=data.cards.find(c=>c.downPayment<=data.playerCash);answer(card?{accepted:true,selectedCardId:card.id}:{accepted:false});});
    p.on('charityCardPending',()=>answer({accepted:false}));p.on('relationshipCardDrawn',()=>answer({accepted:false}));
    p.on('crisisNTSkipAvailable',()=>answer({useNTSkip:true}));p.on('crisisRescueRequired',()=>answer({accepted:false}));
    p.on('fastTrackDealCard',()=>answer({accepted:false}));
  }
  const ended=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Game stuck: '+JSON.stringify({round:latest?.turnNumber,phase:latest?.decisionPhase,scene:latest?.facilitatorScene?.kind,turn:latest?.currentPlayerTurnId,rolledKey,busy:latest?.turnInProgress,paused:latest?.isPaused,payday:latest?.globalPaydayInProgress,pending:latest?.globalPaydayPending,clientErrors:clientErrors.slice(-5)}))),15000);host.on('gameStateUpdate',g=>{if(g.gamePhase==='GameOver'){clearTimeout(timer);resolve(g);}});});
  host.emit('startGame',{force:true});const final=await ended;
  assert.ok(final.turnNumber>=12);assert.ok(choices>15);assert.ok(settlements>=12);assert.equal(maxRetirementCohort,3);assert.ok(final.globalPaydayNumber>=4);
  assert.equal(errors.trim(),'');
});
