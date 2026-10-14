import { AssetType, GameState, Player } from './gameDataModels';

// Game-only numbers. All players see the same two offers; no shared stock or refresh lottery.
const RENTALS = [
  {id:'studio',name:'小型出租套房',price:900000,rent:5000,operating:700},
  {id:'apartment',name:'社區出租公寓',price:1600000,rent:8500,operating:1200},
  {id:'family',name:'家庭出租住宅',price:2600000,rent:13000,operating:2000},
  {id:'shop',name:'街邊出租店面',price:4000000,rent:22000,operating:3500},
] as const;
const money=(n:number)=>'$'+n.toLocaleString('zh-TW');

export function rentalPlanningOffers(gs: GameState,p: Player) {
  const index=Math.max(0,Math.floor(gs.turnNumber/3)-1)%RENTALS.length;
  return [RENTALS[index],RENTALS[(index+1)%RENTALS.length]].map(o=>{
    const downPayment=Math.round(o.price*0.35),loan=o.price-downPayment,fee=Math.round(o.price*0.02);
    const monthlyPayment=Math.round(loan*0.04/12),net=o.rent-o.operating-monthlyPayment;
    const reason=!p.isAlive||p.isBedridden?'目前無法辦理置產。'
      :!gs.boardJourneyEnabled||gs.decisionPhase?.kind!=='actions'||gs.actionPhaseDone.has(p.id)?'只在人生規劃期間辦理。'
      :p.lastRentalPurchaseRound===gs.turnNumber?'本次人生規劃已購買一間。'
      :p.cash<downPayment+fee?'現金不足以支付頭期款及交易費。':undefined;
    return {...o,downPayment,loan,fee,monthlyPayment,net,cashNeeded:downPayment+fee,reason,
      description:`總價 ${money(o.price)}；頭期款 ${money(downPayment)}＋交易費 ${money(fee)}，需現金 ${money(downPayment+fee)}。貸款 ${money(loan)}，模擬年息 4%，每月只付息 ${money(monthlyPayment)}；本金不自動減少，須主動還款或出售結清。月租金 ${money(o.rent)}－管理維護 ${money(o.operating)}－利息，基礎月淨收入 ${money(net)}（財商及行情另計）。空置時月租為零，維護與利息照付；另有大修、房價下跌風險。這不是自住房，不減免自己的房租。${reason??''}`};
  });
}

export function buyPlanningRental(gs: GameState,p: Player,id: string): string {
  const o=rentalPlanningOffers(gs,p).find(x=>x.id===id);
  if(!o||o.reason)return (o?.reason??'房源已更新。')+'未購買、未扣款。';
  const assetId=`rental-${p.id}-${gs.turnNumber}`,loanId=`rental-loan-${p.id}-${gs.turnNumber}`;
  p.cash-=o.cashNeeded;
  p.liabilities.push({id:loanId,name:o.name+'貸款（只付息）',totalDebt:o.loan,monthlyPayment:o.monthlyPayment,monthlyRate:0.04/12});
  p.assets.push({id:assetId,name:o.name,type:AssetType.RealEstate,cost:o.price,currentValue:o.price,downPayment:o.downPayment,
    monthlyCashflow:o.rent,rentalOperatingCost:o.operating,linkedLiabilityId:loanId});
  p.lastRentalPurchaseRound=gs.turnNumber;
  return `購入${o.name}：支付 ${money(o.cashNeeded)}，新增貸款 ${money(o.loan)}；基礎月淨收入 ${money(o.net)}。本金須另行償還；空置仍付維護與利息。`;
}
