// Isolated test process: deterministic dice + shortened animation only, no production test endpoint.
const originalTimeout=global.setTimeout;
global.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms===3600||ms===240?10:ms,...args);
Math.random=()=>0;
const logic=require('../../dist/gameLogic');
const create=logic.createPlayer;
logic.createPlayer=(...args)=>{const p=create(args[0],args[1],'teacher');p.pre20Done=true;p.cash=2000000;p.stats.health=100;return p;};
const server=require('../../dist/socketServer');
process.on('message', async m=>{
  try{
    const gs=server.rooms.get('BOARD6');let result=true;
    if(m.action==='position'){const p=gs.players.get(m.id);p.currentPosition=m.position;p.boardDirection=m.direction;}
    if(m.action==='passService'){const p=gs.players.get(m.id);p.currentPosition=19;result=await require('../../dist/boardJourney').moveBoardJourney({},gs,p,2);}
    if(m.action==='planning'){gs.turnNumber=3;gs.lastPaidRound=3;server.continueAfterTurnAdvance(gs);}
    if(m.action==='outer'){const p=gs.players.get(m.id);p.isInFastTrack=true;require('../../dist/bucketList').assignBucketList(p,gs);}
    if(m.action==='inner'){const p=gs.players.get(m.id);p.isInFastTrack=false;p.secondLifeJourney=undefined;p.bucketList=[];}
    if(m.action==='seedRestart'){gs.lastPaidRound=17;gs.lastCommunityChoicePayday=5;gs.communityChoiceHistory=['old'];gs.actionPhaseRound=17;gs.retirementQueue=['old'];}
    if(m.action==='auditRestart'){result={paid:gs.lastPaidRound,community:gs.lastCommunityChoicePayday,history:gs.communityChoiceHistory,action:gs.actionPhaseRound,retirement:gs.retirementQueue};}
    if(m.action==='retirement'){gs.turnNumber=require('../../dist/gameConfig').RETIREMENT_ROUND;gs.actionPhaseRound=gs.turnNumber;require('../../dist/lifeProgress').queueRetirementCandidates(gs);require('../../dist/lifeProgress').tryOpenRetirementScene(gs);}
    if(m.action==='qualification'){
      const p=gs.players.get(m.id);p.hasPassedSecondLife=true;p.stats.health=100;p.stats.careerSkill=100;p.relationshipPoints=100;p.lifeExperience=100;
      p.assets.push({id:'qualified',type:'Other',name:'測試',cost:1,currentValue:1,monthlyCashflow:1000000});p.paydayCount=12;
      const life=require('../../dist/lifeProgress');const view=require('../../dist/playerView');
      p.secondLifeStableRounds=1;const first=view.buildSecondLifeProgress(p,true).eligible;
      p.secondLifeStableRounds=2;life.queueSecondLifeCandidates(gs,p);const second=view.buildSecondLifeProgress(p,true).eligible;
      p.assets=[];p.stats.financialIQ=1;life.tryOpenSecondLife(gs);const revoked=!!gs.facilitatorScene;
      const {GameState,GamePhase}=require('../../dist/gameDataModels');
      const audit=new GameState('STABLE');audit.gamePhase=GamePhase.RatRace;
      const steady=create('steady','穩定資格','teacher');steady.cash=1000000;steady.stats.health=100;steady.stats.careerSkill=100;steady.hasPassedSecondLife=true;
      steady.assets.push({id:'income',type:'Other',name:'穩定收入',cost:1,currentValue:1,monthlyCashflow:100000});audit.addPlayer(steady);
      const {payCompletedRounds}=require('../../dist/paydayFlow');audit.turnNumber=1;payCompletedRounds(audit);const afterFirst=steady.secondLifeStableRounds;
      payCompletedRounds(audit);const repeated=steady.secondLifeStableRounds;
      audit.turnNumber=2;payCompletedRounds(audit);const afterSecond=steady.secondLifeStableRounds;
      steady.assets=[];audit.turnNumber=3;payCompletedRounds(audit);
      result={first,second,revoked,afterFirst,repeated,afterSecond,reset:steady.secondLifeStableRounds,cycles:audit.globalPaydayNumber};
    }
    process.send({request:m.request,result});
  }catch(e){process.send({request:m.request,error:e.stack});}
});
setTimeout(()=>process.send({ready:true}),150);
