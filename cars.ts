/**
 * 車子（2026-10-01 起）：買車、賣二手車、折舊、手機報價。
 * 自用車資產與車貸沿用 householdLoans 的 car-{id} / car-loan-{id}，提前還款也沿用。
 */
import { AssetType, type Player } from './gameDataModels';
import {
  CAR_DEPRECIATION_PER_YEAR, CAR_DOWN_PAYMENT_RATIO, CAR_LOAN_MONTHLY_RATE, CAR_LOAN_TERM_MONTHS, CAR_OPTIONS,
  WORK_VEHICLE_BY_PROFESSION, type CarOption,
} from './gameConfig';
import { carAssetId, carLoanId } from './householdLoans';

export function carLoanPayment(principal: number): number {
  if (principal <= 0) return 0;
  return Math.round(principal * CAR_LOAN_MONTHLY_RATE / (1 - Math.pow(1 + CAR_LOAN_MONTHLY_RATE, -CAR_LOAN_TERM_MONTHS)));
}

/** 沒有車時的交通費（假設沒有車，用來和養車比較） */
export function transitFeeWithoutCar(player: Player): number {
  const car = player.car;
  player.car = null;
  const fee = player.transportExpense;
  player.car = car;
  return fee;
}

export interface CarOffer {
  id: CarOption['id']; name: string; price: number; downPayment: number; loan: number; loanMonthly: number;
  runningCost: number; lifeExpPerRound: number; monthlyWithLoan: number; transitSaved: number;
  canLoan: boolean; canCash: boolean; reason?: string;
}

export function getCarOffers(player: Player): CarOffer[] {
  const transit = transitFeeWithoutCar(player);
  return CAR_OPTIONS.filter((o) => o.purchasable).map((o) => {
    const downPayment = Math.round(o.price * CAR_DOWN_PAYMENT_RATIO);
    const loan = o.price - downPayment;
    const loanMonthly = carLoanPayment(loan);
    const runningCost = Math.round(o.runningCost * player.livingCostMultiplier);
    let reason: string | undefined;
    if (player.car) reason = `已經有${player.car.name}；想換車請先賣掉`;
    else if (player.isBedridden) reason = '臥床中無法購車';
    else if (player.cash < downPayment) reason = `現金不足：頭期款 $${downPayment.toLocaleString()}`;
    return {
      id: o.id, name: o.name, price: o.price, downPayment, loan, loanMonthly, runningCost, lifeExpPerRound: o.lifeExpPerRound,
      monthlyWithLoan: loanMonthly + runningCost, transitSaved: transit,
      canLoan: !reason, canCash: !reason && player.cash >= o.price, reason,
    };
  });
}

export function buyCar(player: Player, optionId: string, payCash: boolean): { success: boolean; message: string } {
  const offer = getCarOffers(player).find((o) => o.id === optionId);
  const option = CAR_OPTIONS.find((o) => o.id === optionId);
  if (!offer || !option) return { success: false, message: '沒有這種車。' };
  if (payCash ? !offer.canCash : !offer.canLoan) return { success: false, message: offer.reason ?? '現金不足以全額付清。' };
  player.cash -= payCash ? offer.price : offer.downPayment;
  player.assets = player.assets.filter((a) => a.id !== carAssetId(player.id));
  player.liabilities = player.liabilities.filter((l) => l.id !== carLoanId(player.id));
  player.expenses.carLoanPayment = payCash ? 0 : offer.loanMonthly;
  if (!payCash) player.liabilities.push({ id: carLoanId(player.id), name: `車貸（${option.name}）`, totalDebt: offer.loan, monthlyPayment: offer.loanMonthly });
  player.assets.push({ id: carAssetId(player.id), name: option.name, type: AssetType.Other, cost: offer.price, currentValue: offer.price, monthlyCashflow: 0,
    ...(payCash ? {} : { linkedLiabilityId: carLoanId(player.id) }) });
  player.car = { optionId: option.id, name: option.name, runningCost: option.runningCost, lifeExpPerRound: option.lifeExpPerRound, workVehicle: false };
  player.lifeExperience += option.lifeExpOnPurchase;
  return { success: true, message: `買了${option.name}（$${offer.price.toLocaleString()}）${payCash ? '，現金付清' : `：頭期款 $${offer.downPayment.toLocaleString()}，車貸每月 $${offer.loanMonthly.toLocaleString()}`}；每月養車費 $${offer.runningCost.toLocaleString()}，不用再付交通費。` };
}

/** 賣二手車：拿回目前市值，先還清車貸；之後改付交通費 */
export function sellCar(player: Player): { success: boolean; message: string; proceeds?: number; debtSettled?: number; netCashChange?: number } {
  if (!player.car) return { success: false, message: '沒有車可以賣。' };
  const asset = player.assets.find((a) => a.id === carAssetId(player.id));
  const loan = player.liabilities.find((l) => l.id === carLoanId(player.id));
  const proceeds = Math.round(asset?.currentValue ?? 0);
  const debtSettled = loan?.totalDebt ?? 0;
  const netCashChange = proceeds - debtSettled;
  const name = player.car.name;
  const wasWork = player.car.workVehicle;
  player.cash += netCashChange;
  player.assets = player.assets.filter((a) => a.id !== carAssetId(player.id));
  player.liabilities = player.liabilities.filter((l) => l.id !== carLoanId(player.id));
  player.expenses.carLoanPayment = 0;
  player.car = null;
  return { success: true, proceeds, debtSettled, netCashChange,
    message: `賣掉${name}：二手價 $${proceeds.toLocaleString()}${debtSettled ? `，還清車貸 $${debtSettled.toLocaleString()}` : ''}，淨得 $${netCashChange.toLocaleString()}。之後每月付交通費。${wasWork ? '（工作用車賣掉後，工作改搭交通工具）' : ''}` };
}

/** 每輪發薪時：車子依經過年數折舊，好車帶來的體驗照輪數加 */
export function ageCar(player: Player, years: number): void {
  if (!player.car) return;
  const asset = player.assets.find((a) => a.id === carAssetId(player.id));
  if (asset) asset.currentValue = Math.round(asset.currentValue * Math.pow(1 - CAR_DEPRECIATION_PER_YEAR, years));
  if (player.car.lifeExpPerRound > 0) player.lifeExperience += player.car.lifeExpPerRound;
}

/** Pre-20 選定職業後：靠車工作的職業配工作用車，其他職業沒有車 */
export function assignStartingVehicle(player: Player): void {
  if (player.car && !player.car.workVehicle) return;
  const option = CAR_OPTIONS.find((o) => o.id === WORK_VEHICLE_BY_PROFESSION[player.profession.id]);
  player.car = option ? { optionId: option.id, name: option.id === 'scooter' ? option.name : '工作用車', runningCost: option.runningCost, lifeExpPerRound: 0, workVehicle: true } : null;
}
