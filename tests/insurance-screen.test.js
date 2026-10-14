const test=require('node:test');
const assert=require('node:assert/strict');
const {fork}=require('node:child_process');
const {io}=require('socket.io-client');
const wait=(s,e,p=()=>true)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{s.off(e,f);reject(Error(e));},10000);const f=d=>{if(p(d)){clearTimeout(timer);s.off(e,f);resolve(d);}};s.on(e,f);});
const send=(s,e,data,event,p)=>{const result=wait(s,event,p);s.emit(e,data);return result;};
test('insured crisis reaches host-controlled shared-screen summary with matching claim and cash',{timeout:20000},async t=>{
 const child=fork(require.resolve('./helpers/board-v6-server.cjs'),[],{env:{...process.env,PORT:'3420',NODE_ENV:'test'},silent:true});const sockets=[];
 t.after(()=>{sockets.forEach(s=>s.disconnect());child.kill();});await wait(child,'message',m=>m.ready);
 const connect=async()=>{const s=io('http://127.0.0.1:3420',{transports:['websocket']});sockets.push(s);await wait(s,'connect');return s;};
 const host=await connect(),p=await connect(),display=await connect();
 await send(host,'createRoom',{roomId:'BOARD6'},'roomCreated');
 const session=await send(p,'playerJoin',{roomCode:'BOARD6',playerName:'保障測試'},'playerSession');
 await send(display,'joinDisplay',{roomId:'BOARD6'},'gameStateUpdate');
 await send(host,'startGame',{force:true},'gameStateUpdate',g=>g.gamePhase==='RatRace');
 for(const action of ['position','insurance']){const done=wait(child,'message',m=>m.request===action);child.send({request:action,action,id:session.playerId,position:20});await done;}
 const reading=await send(p,'playerRoll',{diceCount:1},'gameStateUpdate',g=>g.decisionPhase?.kind==='reading');
 const shared=wait(display,'gameStateUpdate',g=>g.decisionPhase?.kind==='reading'&&g.decisionPhase.description?.includes('理賠'));
 const result=wait(p,'cardApplied',e=>e.effect?.card?.id==='cr-011');
 host.emit('continueDecisionPhase',{phaseId:reading.decisionPhase.id});
 const applied=(await result).effect;assert.equal(applied.insurancePayout,30000);assert.equal(applied.cashPaid,10000);
 const g=await shared;assert.match(g.decisionPhase.description,/未承保影響/);assert.match(g.decisionPhase.description,/應自付/);
 assert.equal(g.players[0].insuranceClaimsPaid,30000);assert.equal(g.players[0].cash,1990000);
});
