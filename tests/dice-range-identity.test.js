const test = require('node:test');
const assert = require('node:assert/strict');
const {reachableDiceCells,nextInnerNode} = require('../dist/frontend/src/boardLayout');
const {crisisFitsPlayer,relationshipForPlayer,canBeLaidOff} = require('../dist/eventEligibility');
const {CRISIS_EVENTS,RELATIONSHIP_EVENTS} = require('../dist/gameCards');

test('dice ranges match exhaustive rolls and branch choices, including charity dice',()=>{
  for(const outer of [false,true]) for(let pos=0;pos<(outer?17:24);pos++) for(const dice of [1,2,3]) for(const direction of [undefined,'career','life']){
    const expected=new Set();
    const walk=(p,left,step)=>{
      if(!left){expected.add(p);return;}
      if(outer)walk((p+1)%17,left-1,step+1);
      else if(p===3||p===13)for(const d of step===0&&direction?[direction]:['career','life'])walk(nextInnerNode(p,d),left-1,step+1);
      else walk(nextInnerNode(p),left-1,step+1);
    };
    for(let total=dice;total<=6*dice;total++)walk(pos,total,0);
    assert.deepEqual(reachableDiceCells(pos,outer,dice,direction),[...expected].sort((a,b)=>a-b));
  }
  assert.ok(!reachableDiceCells(3,false,1,'life').includes(4));
});

test('crises respect property/business ownership, layoffs respect profession and retirement',()=>{
  const p={housing:'rent',assets:[],profession:{quadrant:'E'},retirementStatus:'working'};
  const card=id=>CRISIS_EVENTS.find(c=>c.id===id);
  assert.equal(crisisFitsPlayer(p,card('cr-004')),false);
  assert.equal(crisisFitsPlayer(p,card('cr-005')),false);
  assert.equal(crisisFitsPlayer(p,card('cr-001')),true);
  assert.equal(canBeLaidOff(p),true);
  p.profession.quadrant='S';assert.equal(crisisFitsPlayer(p,card('cr-005')),true);assert.equal(canBeLaidOff(p),false);
  p.profession.quadrant='E';p.retirementStatus='retired';assert.equal(canBeLaidOff(p),false);
  p.housing='own';assert.equal(crisisFitsPlayer(p,card('cr-006')),true);
});

test('unmarried spouse cards use the fallback title AND effect without mutating deck',()=>{
  for(const c of RELATIONSHIP_EVENTS.filter(c=>c.effect.spouseEvent)){
    const next=relationshipForPlayer({isMarried:false},c);
    assert.equal(next.title,c.effect.unmarriedFallback.title);
    assert.equal(next.effect.spouseEvent,undefined);
    assert.equal(relationshipForPlayer({isMarried:true},c),c);
    assert.ok(c.effect.spouseEvent);
  }
});
