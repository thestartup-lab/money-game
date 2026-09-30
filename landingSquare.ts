/** 玩家落在棋盤格子時的處理：內圈與外圈每一種格子 */
import { Socket } from 'socket.io';
import { GameState, Player, AssetType } from './gameDataModels';
import { getLayoffMonths } from './gameLogic';
import { getLoanLimit } from './gameConfig';
import { rollDice, triggerPayday, takeLeverageLoan, getAvailableLoan, getCurrentAge, getLifeStage, applyFastTrackAppreciation, applyFastTrackPaydayBonus } from './gameLogic';
import { HP_ACTIVITY_THRESHOLDS, CRISIS_FREQ_BY_STAGE, CONSULTANT_SK_RATE, CONSULTANT_NT_RATE } from './gameConfig';
import { applyHPChange } from './statsSystem';
import { rollPropertyEvent } from './propertyRisks';
import { getSquareType, SquareType, DealCard, CharityCard, CHARITY_CARD, getFastTrackSquareType, FastTrackSquareType, FAST_TRACK_BOARD, CRISIS_POOL_BY_STAGE, CRISIS_EVENTS, RELATIONSHIP_EVENTS, BIG_DEALS, MARKET_CARDS, LUCKY_CARDS } from './gameCards';
import { liquidValue, raiseCashFromLiquid } from './liquidity';
import { previewCrisisCost, dealScaleFor, scaleDealCard, applyDoodadCard, applyDownsizingCard, applyMarketCard, acceptDealCard, applyCharityDonation, applyCrisisCard, applyRelationshipCard, applyLuckyCard, getCharityDonationAmount } from './cardSystem';
import {
  applyCrisisWithRescue, applyPartnershipBenefits, beginHostDecisionPhase, calcNetWorth, checkBucketGoals, eliminatePlayer,
  emitCellEvent, emitClient, emitToRoom, executeTravelAction, getPlayerSocket, io,
  logPlayerEvent, playerIdentity, scaleFastTrackCrisis, serializeGameState, startFamilyScene, startMarriageScene,
  waitForCardDecision, waitForHostRelease,
} from './socketServer';

export async function handleLandingSquare(
  socket: Socket,
  player: Player,
  gs: GameState
): Promise<void> {
  const roomId = gs.gameId;

  // ── 外圈落點處理 ─────────────────────────────────────────
  if (player.isInFastTrack) {
    const ftSqType = getFastTrackSquareType(player.fastTrackPosition);
    const sqLabel = FAST_TRACK_BOARD[player.fastTrackPosition % FAST_TRACK_BOARD.length]?.label ?? '';

    emitToRoom(roomId, 'fastTrackLanding', {
      playerId: player.id,
      playerName: player.name,
      position: player.fastTrackPosition,
      squareType: ftSqType,
      label: sqLabel,
    });

    switch (ftSqType) {
      case FastTrackSquareType.PaydayBonus: {
        // ⚠ 修正：playerRoll 的 passedPaydays 已經呼叫 triggerPayday + paydayCount++ 了，
        // 此處不再重複加 monthlyCashflow / paydayCount，只做「外圈發薪日專屬獎勵」：
        //   1. 資產總值 × 1% 紅利現金（applyFastTrackPaydayBonus）
        //   2. 所有資產 currentValue × 1.06 增值（applyFastTrackAppreciation）
        const bonus = applyFastTrackPaydayBonus(player);
        applyFastTrackAppreciation(player);
        emitCellEvent(socket, roomId, player.name, 'FT 發薪日獎勵', `💰 外圈發薪日獎勵！紅利現金 +$${bonus.toLocaleString()} + 全資產 +6% 增值。`);
        emitToRoom(roomId, 'fastTrackPayday', {
          playerId: player.id, playerName: player.name,
          cashflow: 0, bonus, cashAfter: player.cash,
        });
        break;
      }
      case FastTrackSquareType.BigRealEstate:
      case FastTrackSquareType.BusinessDeal:
      case FastTrackSquareType.StockOpportunity: {
        // 大型交易：從現有大交易牌組抽牌
        const { BIG_DEALS } = require('./gameCards');
        const deal: DealCard = BIG_DEALS[Math.floor(Math.random() * BIG_DEALS.length)];
        emitCellEvent(socket, roomId, player.name, 'FT 大交易', `💼 外圈大型投資機會：${deal.title}！`);
        const _ftLoanAvailable = getAvailableLoan(player);
        const ftDealDecision = await waitForCardDecision(socket, gs, player, 'deal', '外圈大型交易', { event: 'fastTrackDealCard', payload: {
          squareType: ftSqType,
          deal,
          isFastTrack: true,
          playerCash: player.cash,
          creditScore: player.creditScore,
          loanAvailable: _ftLoanAvailable,
        } });
        const ftCost = deal.asset.downPayment ?? deal.asset.cost;
        if (ftDealDecision?.accepted === true || ftDealDecision?.accept === true) {
          // 先處理槓桿借款（現金不足→借差額；現金已足且選 leverage→主動槓桿借款留現金）
          if (ftDealDecision.useLeverage === true && ftCost > 0) {
            const _ftAvailableLoan = getAvailableLoan(player);
            const ftBorrow =
              player.cash < ftCost
                ? ftCost - player.cash
                : Math.min(ftCost, _ftAvailableLoan);
            if (ftBorrow > 0) {
              const lvResult = takeLeverageLoan(player, ftBorrow, deal.title);
              if (!lvResult.success) {
                emitClient(socket, 'error', { message: `投資槓桿借款失敗：${lvResult.message}` });
                break;
              }
              emitClient(socket, 'loanTaken', {
                liabilityId: lvResult.liabilityId,
                loanType: 'leverage',
                amount: lvResult.amount,
                monthlyPayment: lvResult.monthlyPayment,
                newCreditScore: lvResult.newCreditScore,
              });
            }
          }

          if (player.cash >= ftCost) {
            acceptDealCard(player, deal);
            emitCellEvent(socket, roomId, player.name, 'FT 大交易', `✅ 成交！${deal.title} 月現金流 +$${deal.asset.monthlyCashflow.toLocaleString()}`);
            emitToRoom(roomId, 'cardApplied', {
              playerId: player.id,
              squareType: ftSqType,
              effect: { type: 'dealAccepted', card: deal },
            });
          } else {
            emitClient(socket, 'error', { message: `現金不足，無法購買 ${deal.title}（需 $${ftCost.toLocaleString()}）。` });
          }
        }
        break;
      }
      case FastTrackSquareType.NetworkSummit: {
        const ntPerLevel = 30_000;
        const ntBonus = player.stats.network * ntPerLevel;
        player.cash += ntBonus;
        player.lifeExperience += 8;
        emitCellEvent(socket, roomId, player.name, 'FT 人際關係', `🤝 人脈高峰！人脈值 ${player.stats.network} × $${ntPerLevel.toLocaleString()} = +$${ntBonus.toLocaleString()}。`);
        emitToRoom(roomId, 'fastTrackNetworkSummit', {
          playerId: player.id, playerName: player.name,
          ntLevel: player.stats.network, cashBonus: ntBonus,
        });
        break;
      }
      case FastTrackSquareType.Charity: {
        const charityAmount = Math.round(player.monthlyCashflow * 0.1);
        if (player.cash >= charityAmount && charityAmount > 0) {
          const charityDecision = await waitForCardDecision(socket, gs, player, 'charity', '外圈慈善選擇', { event: 'charityCardPending', payload: { amount: charityAmount } });
          if (charityDecision?.donate === true) {
            player.cash -= charityAmount;
            player.charityTotal = (player.charityTotal ?? 0) + charityAmount;
            player.lifeExperience += 15;
            player.legacyBonusPoints += 5;
            emitCellEvent(socket, roomId, player.name, 'FT 慈善', `❤️ 外圈慈善！捐出 $${charityAmount.toLocaleString()}，累積慈善 $${player.charityTotal.toLocaleString()}，生命體驗 +15、傳承 +5。`);
            emitToRoom(roomId, 'fastTrackCharity', {
              playerId: player.id, playerName: player.name,
              amount: charityAmount, legacyBonus: 5, charityTotal: player.charityTotal,
            });
            checkBucketGoals(player, gs, roomId, socket);
          } else {
            emitCellEvent(socket, roomId, player.name, 'FT 慈善', '❤️ 這次選擇保留資金，略過捐款。');
          }
        } else {
          emitCellEvent(socket, roomId, player.name, 'FT 慈善', '❤️ 外圈慈善格，現金不足或現金流為零，跳過捐款。');
        }
        break;
      }
      case FastTrackSquareType.TaxPlanning: {
        player.taxPlanningCreditRate = Math.max(player.taxPlanningCreditRate ?? 0, 0.3);
        emitCellEvent(socket, roomId, player.name, 'FT 稅務規劃', '📊 稅務優化完成！下次年度結算可減免 30% 應繳稅額。');
        emitToRoom(roomId, 'fastTrackTaxPlanning', {
          playerId: player.id, playerName: player.name, taxCreditRate: player.taxPlanningCreditRate,
        });
        break;
      }
      case FastTrackSquareType.TechStartup: {
        // 科技新創：隨機投資金額，擲骰決定成敗
        const amounts = [300_000, 750_000, 1_500_000];
        const investmentAmount = amounts[Math.floor(Math.random() * amounts.length)];
        emitCellEvent(socket, roomId, player.name, 'FT 科技新創', `💡 科技新創機會！投入 $${investmentAmount.toLocaleString()} 擲骰決定成敗（≥4 成功）。`);
        const startupDecision = await waitForCardDecision(socket, gs, player, 'startup', '科技新創投資', { event: 'techStartupOffer', payload: {
          playerId: player.id,
          playerName: player.name,
          investmentAmount,
          playerCash: player.cash,
        } });
        if (startupDecision?.invest === true && player.cash >= investmentAmount) {
          player.cash -= investmentAmount;
          const diceRoll = rollDice(1);
          const networkBonus = player.stats.network >= 5 ? 1 : 0;
          const success = (diceRoll + networkBonus) >= 4;
          if (success) {
            const monthlyCashflow = Math.round(investmentAmount * 0.1);
            player.assets.push({
              id: `startup-${player.id}-${Date.now()}`,
              name: '科技新創股份',
              type: AssetType.Other,
              cost: investmentAmount,
              currentValue: investmentAmount,
              monthlyCashflow,
            });
            emitClient(socket, 'techStartupResult', {
              playerId: player.id,
              invested: true,
              success: true,
              diceRoll,
              investmentAmount,
              monthlyCashflow,
              cashAfter: player.cash,
            });
          } else {
            emitClient(socket, 'techStartupResult', {
              playerId: player.id,
              invested: true,
              success: false,
              diceRoll,
              investmentAmount,
              cashAfter: player.cash,
            });
          }
        } else {
          emitClient(socket, 'techStartupResult', { playerId: player.id, invested: false, investmentAmount });
        }
        break;
      }
      case FastTrackSquareType.GlobalWave: {
        const { MARKET_CARDS } = require('./gameCards');
        const evt = MARKET_CARDS[Math.floor(Math.random() * MARKET_CARDS.length)];
        // applyMarketCard 內部已遍歷所有玩家，呼叫一次即可（之前 for 迴圈會造成 N 倍效果）
        applyMarketCard(gs, evt);
        emitCellEvent(socket, roomId, player.name, 'FT 全球浪潮', `🌊 全球市場波動：${evt.title}，影響所有玩家資產！`);
        emitToRoom(roomId, 'globalWaveEvent', { triggeredBy: player.name, event: evt });
        emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
        break;
      }
      case FastTrackSquareType.Partnership: {
        const others = [...gs.players.values()].filter((p) => p.id !== player.id && p.isAlive);
        if (others.length > 0) {
          emitCellEvent(socket, roomId, player.name, 'FT 合夥機會', '🤝 合夥機會！先選擇邀請對象，再由對方決定是否合作。');
          const partnerPick = await waitForCardDecision(socket, gs, player, 'relationship', '外圈合夥：選擇夥伴', { event: 'fastTrackPartnershipOptions', payload: {
            availablePartners: others.map((p) => ({ id: p.id, name: p.name })),
          } });
          const targetId = typeof partnerPick?.targetPlayerId === 'string' ? partnerPick.targetPlayerId : null;
          const target = targetId ? gs.players.get(targetId) : undefined;
          const targetSocket = target ? getPlayerSocket(target.id) : undefined;

          if (target?.isAlive && targetSocket && !target.isDisconnected) {
            const estimatedDividend = Math.max(
              3_000,
              Math.min(50_000, Math.round((player.totalPassiveIncome + target.totalPassiveIncome) * 0.03)),
            );
            const response = await waitForCardDecision(targetSocket, gs, target, 'relationship', `回應 ${player.name} 的合夥邀請`, { event: 'fastTrackPartnershipInvitation', payload: {
              offerorId: player.id,
              offerorName: player.name,
              estimatedDividend,
            } });
            if (response?.accepted === true && player.isAlive && target.isAlive) {
              const dividend = applyPartnershipBenefits(gs, player, target);
              emitCellEvent(socket, roomId, player.name, 'FT 合夥成功', `🤝 ${player.name} 與 ${target.name} 合作成功，雙方各得生命體驗 +15、分紅 $${dividend.toLocaleString()}。`);
              console.log(`[fastTrackPartnership] ${player.name} 與 ${target.name} 合夥成功，分紅 $${dividend}`);
            } else {
              emitToRoom(roomId, 'partnershipDeclined', { offerorId: player.id, targetId: target.id });
              emitCellEvent(socket, roomId, player.name, 'FT 合夥機會', `🤝 ${target.name} 婉拒了本次合作。`);
            }
          } else if (targetId) {
            emitCellEvent(socket, roomId, player.name, 'FT 合夥機會', '🤝 對方目前無法回應，本次合夥略過。');
          } else {
            emitCellEvent(socket, roomId, player.name, 'FT 合夥機會', '🤝 這次選擇不發出合夥邀請。');
          }
        } else {
          emitCellEvent(socket, roomId, player.name, 'FT 合夥機會', '🤝 合夥機會格，但目前沒有其他存活玩家，跳過。');
        }
        break;
      }
      case FastTrackSquareType.Crisis: {
        const { DISEASE_CRISIS_EVENTS } = require('./gameCards');
        const pool = DISEASE_CRISIS_EVENTS ?? [];
        if (pool.length > 0) {
          const c = scaleFastTrackCrisis(player, pool[Math.floor(Math.random() * pool.length)]);
          const _ftcCB = player.cash; const _ftcFB = player.monthlyCashflow; const _ftcNWB = calcNetWorth(player);
          const crisisResult = await applyCrisisWithRescue(socket, gs, player, c, 'FT 危機事件');
          emitCellEvent(socket, roomId, player.name, 'FT 危機事件',
            `⚠️ 外圈危機：${c.title}！${crisisResult.wasInsured ? '保險豁免' : `現金 -$${crisisResult.effectiveCost.toLocaleString()}`}，跳過 ${crisisResult.turnsLost} 回合`);
          logPlayerEvent(player, gs, 'crisis', `外圈危機：${c.title}`, _ftcCB, _ftcFB, _ftcNWB, { cardId: c.id, cardTitle: c.title, deathTriggered: crisisResult.deathTriggered });
          if (crisisResult.deathTriggered) {
            eliminatePlayer(player, gs, 'fastTrackCrisis', `外圈危機「${c.title}」導致死亡`);
            emitToRoom(roomId, 'playerDied', {
              playerId: player.id,
              playerName: player.name,
              cause: '外圈危機',
              crisis: c,
            });
          } else {
            emitClient(socket, 'fastTrackCrisisCard', { crisis: c, result: crisisResult });
          }
        } else {
          emitCellEvent(socket, roomId, player.name, 'FT 危機事件', '✅ 危機牌庫已空，平安通過。');
        }
        break;
      }
      case FastTrackSquareType.LifeJourney: {
        const { TRAVEL_DESTINATIONS } = require('./gameConfig');
        const outerDests = (TRAVEL_DESTINATIONS as Array<{ id: string; name: string; tier: string; cost: number; lifeExpGained: number; region: string }>)
          .filter((d) => d.tier === 'outer' || d.tier === 'both');
        emitCellEvent(socket, roomId, player.name, 'FT 人生旅程', '✈️ 外圈人生旅程！可選擇更遠的旅遊目的地，獲得豐富的生命體驗。');
        const travelDecision = await waitForCardDecision(socket, gs, player, 'relationship', '外圈生命歷練', { event: 'fastTrackTravelOptions', payload: {
          destinations: outerDests.map((d) => ({ id: d.id, name: d.name, region: d.region, cost: d.cost, lifeExpGained: d.lifeExpGained })),
          playerCash: player.cash,
        } });
        if (typeof travelDecision?.destinationId === 'string') {
          executeTravelAction(socket, gs, player, travelDecision.destinationId);
        } else {
          emitCellEvent(socket, roomId, player.name, 'FT 人生旅程', '✈️ 這次選擇留在原地，保存資金。');
        }
        break;
      }
      case FastTrackSquareType.Relationship: {
        if (player.isMarried) {
          startFamilyScene(gs, player, 'outer');
          break;
        }
        const relEvents = require('./gameCards').RELATIONSHIP_EVENTS;
        const rel = relEvents[Math.floor(Math.random() * relEvents.length)];
        if (rel) {
          if (rel.effect?.triggerMarriageWindow) {
            startMarriageScene(gs, player, 'window');
            break;
          }
          const { applyRelationshipCard } = require('./cardSystem');
          applyRelationshipCard(player, rel);
          emitCellEvent(socket, roomId, player.name, 'FT 人際關係', `🤝 外圈人際事件：${rel.title}`);
          emitClient(socket, 'relationshipCardApplied', { card: rel });
        } else {
          emitCellEvent(socket, roomId, player.name, 'FT 人際關係', '🤝 外圈人際關係格，無特殊事件。');
        }
        break;
      }
      case FastTrackSquareType.AssetLeverage: {
        // 資產槓桿：以既有被動收入為基礎，提供一次性但有上限感的資金放大。
        const bonus = Math.max(player.totalPassiveIncome * 2, 75_000);
        player.cash += bonus;
        emitCellEvent(socket, roomId, player.name, 'FT 資產槓桿', `🚀 資產槓桿！獲得 +$${bonus.toLocaleString()} 現金獎勵。`);
        emitClient(socket, 'assetLeverageBonus', {
          playerId: player.id,
          playerName: player.name,
          bonus,
          passiveIncome: player.totalPassiveIncome,
          cashAfter: player.cash,
        });
        break;
      }
      case FastTrackSquareType.DiseaseCrisis: {
        // 疾病危機：強制 HP -20，抽疾病危機牌，套用 applyCrisisCard
        const { DISEASE_CRISIS_EVENTS: diseasePool } = require('./gameCards');
        const hpBefore = player.stats.health;
        const justBedFT = applyHPChange(player, -20);
        if (justBedFT) {
          emitToRoom(roomId, 'playerBedridden', {
            playerId: player.id,
            playerName: player.name,
            age: Math.round(getCurrentAge(gs)),
          });
        }
        // HP -20 先套用，再依扣血後的狀態計算費用（致死卡改為淨值比例）
        const diseaseCard = scaleFastTrackCrisis(player, diseasePool[Math.floor(Math.random() * diseasePool.length)]);
        emitCellEvent(socket, roomId, player.name, 'FT 疾病危機', `🏥 疾病危機：${diseaseCard.title}！HP -20，請確認保險狀態。`);
        const crisisResult = await applyCrisisWithRescue(socket, gs, player, diseaseCard, 'FT 疾病危機');
        if (crisisResult.deathTriggered) {
          eliminatePlayer(player, gs, 'diseaseCrisis', `疾病危機「${diseaseCard.title}」導致死亡`);
          emitToRoom(roomId, 'playerDied', {
            playerId: player.id,
            playerName: player.name,
            cause: '疾病危機',
            crisis: diseaseCard,
          });
        } else {
          emitClient(socket, 'diseaseCrisisCard', {
            crisis: diseaseCard,
            result: crisisResult,
            hpBefore,
            hpAfter: player.stats.health,
          });
        }
        break;
      }
      default:
        emitCellEvent(socket, roomId, player.name, '快速通道格子', '✅ 本格無特殊事件，平安通過。');
        break;
    }

    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
    return;
  }

  // ── 內圈落點處理 ─────────────────────────────────────────
  const squareType = getSquareType(player.currentPosition);

  switch (squareType) {
    case SquareType.Payday:
      emitCellEvent(socket, roomId, player.name, '發薪日', '💰 發薪日到了！領取薪水，並規劃投資與生活安排。');
      break;

    case SquareType.SecondLife:
      // 解鎖邏輯由 playerRoll 內 crossedCell24 偵測處理；停在此格只發提示訊息
      emitCellEvent(socket, roomId, player.name, '第二人生',
        player.hasPassedSecondLife
          ? '🌟 第二人生格！系統正在檢視你的財務基礎與人生累積。'
          : '🌟 你抵達了第二人生格！從此可以接受第二人生資格檢視。');
      break;

    case SquareType.Baby: {
      startFamilyScene(gs, player, 'inner');
      break;
    }

    case SquareType.Doodad: {
      // 有房子的人：有機會改遇到房東的真實風險（空置、大修、調漲租金）
      const cashBeforeProperty = player.cash; const flowBeforeProperty = player.monthlyCashflow; const worthBeforeProperty = calcNetWorth(player);
      const propertyEvent = rollPropertyEvent(player);
      if (propertyEvent) {
        const icon = propertyEvent.kind === 'rentRaise' ? '📈' : propertyEvent.kind === 'vacancy' ? '🏚️' : '🔧';
        emitCellEvent(socket, roomId, player.name, '房東的日常', `${icon} ${propertyEvent.title}：${propertyEvent.description}`);
        emitToRoom(roomId, 'cardApplied', { playerId: player.id, playerName: player.name, squareType, effect: { type: 'propertyEvent', ...propertyEvent } });
        logPlayerEvent(player, gs, 'property_event', `${propertyEvent.title}（${propertyEvent.assetName}）`, cashBeforeProperty, flowBeforeProperty, worthBeforeProperty,
          { propertyEvent: propertyEvent.kind, assetId: propertyEvent.assetId, months: propertyEvent.months });
        break;
      }
      const card = gs.doodadDeck.draw();
      if (!card) {
        emitCellEvent(socket, roomId, player.name, '意外支出', '✅ 本次意外支出牌庫已空，平安通過。');
        break;
      }
      const result = applyDoodadCard(player, card);
      gs.doodadDeck.discard(card);
      emitCellEvent(socket, roomId, player.name, '意外支出', `💸 ${card.title}：意外支出到來！`);
      emitClient(socket, 'cardDrawn', { squareType, card });
      emitToRoom(roomId, 'cardApplied', { playerId: player.id, squareType, effect: result });
      break;
    }

    case SquareType.Downsizing: {
      if (player.retirementStatus !== 'working') {
        // 退休者不會被裁員：職涯轉折格改為一次性顧問案／人脈機會
        const gig = Math.max(15_000, player.stats.network * CONSULTANT_NT_RATE + player.stats.careerSkill * CONSULTANT_SK_RATE);
        player.cash += gig;
        emitCellEvent(socket, roomId, player.name, '職涯轉折', `💼 退休後的一次性顧問案：${player.name} 收到 $${gig.toLocaleString()}。`);
        emitToRoom(roomId, 'cardApplied', { playerId: player.id, playerName: player.name, squareType, effect: { type: 'retireeGig', cashGain: gig } });
        break;
      }
      const layoffMonths = Math.max(1, getLayoffMonths(player));
      applyDownsizingCard(player, {
        id: 'ds-default',
        title: '裁員',
        description: `公司裁員，接下來 ${layoffMonths} 個月沒有薪水。`,
        turnsWithoutSalary: layoffMonths,
      });
      player.layoffMonthsTotal += layoffMonths;
      emitCellEvent(socket, roomId, player.name, '裁員', `⚠️ 公司裁員！${player.name} 接下來 ${layoffMonths} 個月沒有薪水${player.stats.careerSkill >= 60 ? '（第二專長 ≥ 60，找工作時間減半）' : player.currentAge >= 50 ? '（50 歲後再就業更難）' : ''}。`);
      emitToRoom(roomId, 'cardApplied', {
        playerId: player.id,
        squareType,
        effect: { type: 'downsizing', downsizingTurnsLeft: player.downsizingTurnsLeft },
      });
      break;
    }

    case SquareType.Market: {
      const card = gs.marketDeck.draw();
      if (!card) {
        emitCellEvent(socket, roomId, player.name, '市場行情', '📈 市場目前平靜，無特殊波動。');
        break;
      }
      const result = applyMarketCard(gs, card);
      gs.marketDeck.discard(card);
      emitToRoom(roomId, 'marketCardApplied', {
        card,
        affectedAssets: result.affectedAssets,
        dividendsPaid: result.dividendsPaid,
      });
      // Dividend：給每位收益者一次現金事件記錄，方便事後檢視
      if (result.dividendsPaid && result.dividendsPaid.length > 0) {
        for (const div of result.dividendsPaid) {
          const recipient = gs.players.get(div.playerId);
          if (!recipient) continue;
          logPlayerEvent(
            recipient, gs, 'payday',
            `市場配息：${card.title}（+$${div.cashGain.toLocaleString()}）`,
            recipient.cash - div.cashGain,
            recipient.monthlyCashflow,
            calcNetWorth(recipient) - div.cashGain,
            { cardId: card.id, dividendAmount: div.cashGain }
          );
        }
        const summary = result.dividendsPaid
          .map((d) => `${d.playerName} +$${d.cashGain.toLocaleString()}`)
          .join('、');
        emitCellEvent(socket, roomId, player.name, '市場行情',
          `💰 ${card.title}：${summary}`);
      } else {
        emitCellEvent(socket, roomId, player.name, '市場行情', `📈 市場行情：${card.title}`);
      }
      emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
      break;
    }

    case SquareType.SmallDeal:
    case SquareType.BigDeal: {
      const dealTypeName = squareType === SquareType.BigDeal ? '大交易' : '小交易';

      // 機運卡分支：小交易格 30% 機率改抽機運卡（一次性現金入帳，無需玩家決策）
      // 用來補足早期玩家「只有薪水」的進現金管道
      if (squareType === SquareType.SmallDeal && Math.random() < 0.3) {
        const lucky = LUCKY_CARDS[Math.floor(Math.random() * LUCKY_CARDS.length)];
        const _lkCB = player.cash;
        const _lkFB = player.monthlyCashflow;
        const _lkNWB = calcNetWorth(player);
        const lkResult = applyLuckyCard(player, lucky);
        logPlayerEvent(
          player, gs, 'lucky_card',
          `🍀 機運卡：${lucky.title}（+$${lkResult.cashGain.toLocaleString()}）`,
          _lkCB, _lkFB, _lkNWB,
          { cardId: lucky.id, cashGain: lkResult.cashGain }
        );
        emitClient(socket, 'luckyCardDrawn', {
          card: lucky,
          cashGain: lkResult.cashGain,
          newCash: player.cash,
        });
        emitCellEvent(socket, roomId, player.name, '機運卡', `🍀 ${lucky.title}：+$${lkResult.cashGain.toLocaleString()}！`);
        emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
        break;
      }

      emitClient(socket, 'squareLandingNotice', { cellName: dealTypeName, message: `📋 ${dealTypeName}機會出現！查看可用的投資選項。` });
      io.to(roomId).emit('cellEventBroadcast', { playerId: playerIdentity(socket), playerName: player.name, cellName: dealTypeName, message: `📋 ${dealTypeName}機會出現！`, ts: Date.now() });

      if (squareType === SquareType.BigDeal && player.stats.health < HP_ACTIVITY_THRESHOLDS.bigDeal) {
        emitClient(socket, 'error', {
          message: `健康值不足，無法執行大型交易（需要 ${HP_ACTIVITY_THRESHOLDS.bigDeal}，目前 ${player.stats.health}）。`,
        });
        break;
      }

      const deck = squareType === SquareType.SmallDeal ? gs.smallDealDeck : gs.bigDealDeck;
      const nt = player.stats.network;
      const drawCount = nt >= 5 ? 2 : 1;
      // 交易金額依落格玩家的生活規模放大；棄牌時放回原卡，牌庫不會越放越大
      // 大交易的頭期款本來就上百萬，放大倍數取平方根，避免全場都付不起
      const fullScale = dealScaleFor(player);
      const dealScale = squareType === SquareType.BigDeal ? Math.max(1, Math.round(Math.sqrt(fullScale) * 2) / 2) : fullScale;
      const originalOf = new Map<DealCard, DealCard>();
      const drawnCards: DealCard[] = [];
      for (let i = 0; i < drawCount; i++) {
        const c = deck.draw();
        if (!c) continue;
        const scaled = scaleDealCard(c, dealScale);
        originalOf.set(scaled, c);
        drawnCards.push(scaled);
      }
      const discard = (card: DealCard) => deck.discard(originalOf.get(card) ?? card);

      if (drawnCards.length === 0) {
        emitCellEvent(socket, roomId, player.name, dealTypeName, `📋 ${dealTypeName}牌庫已空，本次無交易機會。`);
        break;
      }

      // 步驟1：先讓玩家A決定（再決定是否開拍）
      const cardsForClient = drawnCards.map((c) => ({
        id: c.id,
        name: c.title,
        description: c.description,
        downPayment: c.asset.downPayment ?? c.asset.cost,
        monthlyCashflow: c.asset.monthlyCashflow,
        scale: dealScale,
      }));
      // 計算玩家當前可用「投資槓桿借款」額度（只計算無擔保負債，房貸/事業貸款不計入）
      const _loanAvailable = getAvailableLoan(player);
      const _liquid = liquidValue(player);
      const downPaymentOf = (c: DealCard) => c.asset.downPayment ?? c.asset.cost ?? 0;
      // 現金 + 可借額度 + 可賣的債券／基金／股票，任何一種湊得出頭期款就讓本人決定
      const affordableByMe = drawnCards.some((c) => downPaymentOf(c) <= player.cash + Math.max(_loanAvailable, _liquid));
      if (!affordableByMe) {
        // 本人連槓桿都買不起：不必開決策；若全場也沒人出得起頭期款，直接略過，省下主持人三次點擊
        const othersCanBid = [...gs.players.values()].some((p) =>
          p.isAlive && p.id !== player.id && drawnCards.some((c) => p.cash + liquidValue(p) >= downPaymentOf(c)));
        const cheapest = Math.min(...drawnCards.map(downPaymentOf));
        if (!othersCanBid) {
          emitCellEvent(socket, roomId, player.name, dealTypeName, `📋 ${dealTypeName}「${drawnCards.map((c) => c.title).join('、')}」頭期款 $${cheapest.toLocaleString()}，目前全場都負擔不起，本次略過。`);
          drawnCards.forEach((c) => discard(c));
          break;
        }
        emitCellEvent(socket, roomId, player.name, dealTypeName, `📋 ${player.name} 現金與可借額度不足以承接（頭期款 $${cheapest.toLocaleString()}），直接開放全場競標。`);
      }
      const decision = affordableByMe
        ? await waitForCardDecision(socket, gs, player, 'deal', dealTypeName, {
            event: 'dealCardsDrawn',
            payload: {
              cards: cardsForClient,
              canPickTwo: drawCount > 1,
              playerCash: player.cash,
              creditScore: player.creditScore,
              loanAvailable: _loanAvailable,
              loanLimit: getLoanLimit(player.creditScore),
              liquidValue: _liquid,
            },
          })
        : null;

      if (decision && decision.accepted) {
        // 玩家A接受 → 正常交易流程
        const selectedId = decision.selectedCardId as string | undefined;
        const chosen = selectedId
          ? drawnCards.find((c) => c.id === selectedId) ?? drawnCards[0]
          : drawnCards[0];

        const downPayment = chosen.asset.downPayment ?? chosen.asset.cost ?? 0;

        // 若玩家選擇「用槓桿借款購買」：
        // - 現金不足：借差額補上
        // - 現金已足：主動槓桿，借款金額 = min(downPayment, 借款上限)，把現金留著做別的事
        if (decision.useLeverage === true && downPayment > 0) {
          const availableLoan = getAvailableLoan(player);
          const borrowAmount =
            player.cash < downPayment
              ? downPayment - player.cash
              : Math.min(downPayment, availableLoan);
          if (borrowAmount > 0) {
            const lvResult = takeLeverageLoan(player, borrowAmount, chosen.title);
            if (!lvResult.success) {
              emitClient(socket, 'error', { message: `投資槓桿借款失敗：${lvResult.message}` });
              drawnCards.forEach((c) => discard(c));
              emitToRoom(roomId, 'cardApplied', { playerId: player.id, squareType, effect: { type: 'dealDeclined' } });
              break;
            }
            emitClient(socket, 'loanTaken', {
              liabilityId: lvResult.liabilityId,
              loanType: 'leverage',
              amount: lvResult.amount,
              monthlyPayment: lvResult.monthlyPayment,
              newCreditScore: lvResult.newCreditScore,
            });
          }
        }

        // 選擇「賣債券／基金補足」：依序部分賣出流動資產湊頭期款
        if (decision.useLiquid === true && player.cash < downPayment) {
          const raised = raiseCashFromLiquid(player, downPayment);
          if (raised.sold.length) emitCellEvent(socket, roomId, player.name, dealTypeName, `💱 ${player.name} 賣出 ${raised.sold.join('、')} 湊頭期款。`);
        }

        if (player.cash < downPayment) {
          emitClient(socket, 'error', { message: `現金不足，無法完成此交易（需 $${downPayment.toLocaleString()}，目前 $${player.cash.toLocaleString()}）。` });
          drawnCards.forEach((c) => discard(c));
          emitToRoom(roomId, 'cardApplied', {
            playerId: player.id,
            squareType,
            effect: { type: 'dealDeclined' },
          });
          break;
        }

        const _dcCB = player.cash; const _dcFB = player.monthlyCashflow; const _dcNWB = calcNetWorth(player);
        acceptDealCard(player, chosen);
        logPlayerEvent(player, gs, 'asset_buy', `接受交易：${chosen.title}（月現金流 ${(chosen.asset.monthlyCashflow ?? 0) >= 0 ? '+' : ''}$${chosen.asset.monthlyCashflow ?? 0}）`, _dcCB, _dcFB, _dcNWB, { cardId: chosen.id, cardTitle: chosen.title, monthlyCashflow: chosen.asset.monthlyCashflow, squareType });
        drawnCards.filter((c) => c.id !== chosen.id).forEach((c) => discard(c));
        discard(chosen);

        emitToRoom(roomId, 'cardApplied', {
          playerId: player.id,
          squareType,
          effect: { type: 'dealAccepted', card: chosen },
        });
      } else {
        // 玩家A放棄 → 每張抽到的牌依序開放全場競標，由主持人逐場收束。
        emitToRoom(roomId, 'cardApplied', {
          playerId: player.id,
          squareType,
          effect: { type: 'dealDeclined' },
        });

        // ⚠ 修正：以前 NT≥5 抽 2 張時只拍賣 drawnCards[0]，drawnCards[1] 直接消失
        if (!gs.activeAuctions) gs.activeAuctions = {};

        for (const [idx, auctionCard] of drawnCards.entries()) {
          const minBid = auctionCard.asset.downPayment ?? auctionCard.asset.cost ?? 0;
          const auctionId = `auction-${Date.now()}-${idx}`;
          const auctionEndTime = 0;
          gs.activeAuctions![auctionId] = {
            dealCardId: auctionCard.id,
            startTime: Date.now(), endTime: auctionEndTime,
            highestBid: 0, minBid,
            triggeredBy: player.id, triggeredByName: player.name,
            cardInfo: { name: auctionCard.title, monthlyCashflow: auctionCard.asset.monthlyCashflow ?? 0, downPayment: minBid },
          };

          socket.to(roomId).emit('dealAuctionStarted', {
            auctionId, triggeredBy: player.id, triggeredByName: player.name,
            card: {
              id: auctionCard.id,
              name: auctionCard.title,
              description: auctionCard.description,
              minBid,
              monthlyCashflow: auctionCard.asset.monthlyCashflow,
            },
            endsAt: auctionEndTime,
            controlledByHost: true,
          });

          const decisionContext = beginHostDecisionPhase(
            gs,
            { id: '__all_players__', name: '全體玩家' },
            'auction',
            `交易競標：${auctionCard.title}`,
          );
          await waitForHostRelease(gs, decisionContext);

          const auction = gs.activeAuctions?.[auctionId];
          if (!auction) {
            discard(auctionCard);
            continue;
          }
          delete gs.activeAuctions![auctionId];

          if (auction.highestBidderId && auction.highestBid >= minBid) {
            const winner = gs.players.get(auction.highestBidderId);
            // 得標者現金不夠時，用債券／基金／股票補足（出價時已確認湊得出來）
            if (winner && winner.cash < auction.highestBid) raiseCashFromLiquid(winner, auction.highestBid);
            if (winner && winner.cash >= auction.highestBid) {
              const _wCB = winner.cash; const _wFB = winner.monthlyCashflow; const _wNWB = calcNetWorth(winner);
              // 得標金由銀行收取；付給放棄者會變成兩人串通把頭期款互相轉手
              acceptDealCard(winner, auctionCard, auction.highestBid);
              logPlayerEvent(winner, gs, 'asset_buy', `競標得標：${auctionCard.title}（月現金流 ${(auctionCard.asset.monthlyCashflow ?? 0) >= 0 ? '+' : ''}$${auctionCard.asset.monthlyCashflow ?? 0}）`, _wCB, _wFB, _wNWB, { cardId: auctionCard.id, cardTitle: auctionCard.title, monthlyCashflow: auctionCard.asset.monthlyCashflow });
              emitToRoom(roomId, 'dealAuctionEnded', {
                auctionId,
                winnerId: auction.highestBidderId,
                winnerName: auction.highestBidderName,
                winningBid: auction.highestBid,
                cardName: auctionCard.title,
                hadBids: true,
              });
              emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
              discard(auctionCard);
              continue;
            }
          }

          emitToRoom(roomId, 'dealAuctionEnded', {
            auctionId, winnerId: null, winnerName: null,
            winningBid: 0, cardName: auctionCard.title, hadBids: false,
          });
          emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
          discard(auctionCard);
        }
      }
      break;
    }

    case SquareType.Charity: {
      const card: CharityCard = CHARITY_CARD;
      const donationAmount = getCharityDonationAmount(player, card);

      emitCellEvent(socket, roomId, player.name, '慈善捐款', `❤️ 慈善格子！捐出 $${donationAmount.toLocaleString()} 可獲得生命體驗與傳承加成，是否參與？`);
      const decision = await waitForCardDecision(socket, gs, player, 'charity', '慈善捐款', { event: 'charityCardPending', payload: { amount: donationAmount } });
      const donate = decision?.donate === true;

      applyCharityDonation(player, card, donate);

      emitToRoom(roomId, 'cardApplied', {
        playerId: player.id,
        squareType,
        effect: {
          type: 'charity',
          donated: donate,
          donationAmount: donate ? donationAmount : 0,
          bonusDice: player.bonusDice,
          charityTotal: player.charityTotal,
        },
      });
      if (donate) checkBucketGoals(player, gs, roomId, socket);
      break;
    }

    case SquareType.Crisis: {
      const currentAge = getCurrentAge(gs);
      const stage = getLifeStage(currentAge);

      // 危機觸發機率公式（修正前 1.0/2.2≈45% 過低，年輕期幾乎都閃過）：
      //   trigger = clamp(freqMultiplier × 0.65, 0.6, 1.0)
      // Youth: 65%, Family: 78%, Transition: 97%, Retirement+: 100%
      const freqMultiplier = CRISIS_FREQ_BY_STAGE[stage];
      const triggerProb = Math.max(0.6, Math.min(1, freqMultiplier * 0.65));
      if (Math.random() > triggerProb) {
        emitCellEvent(socket, roomId, player.name, '危機事件', '🍀 恭喜！這次危機擦身而過，平安無事。');
        emitToRoom(roomId, 'cardApplied', {
          playerId: player.id,
          squareType,
          effect: { type: 'crisisAvoided', stage },
        });
        break;
      }

      const stagePool = CRISIS_POOL_BY_STAGE[stage];
      const stageCards = CRISIS_EVENTS.filter((c) => stagePool.includes(c.id));
      const eligibleCards = stageCards.length > 0 ? stageCards : CRISIS_EVENTS;
      const card = eligibleCards[Math.floor(Math.random() * eligibleCards.length)];

      emitCellEvent(socket, roomId, player.name, '危機事件', `⚠️ 危機來臨：${card.title}！`);

      // 人脈護盾（整場一次）只在沒有對應保險時才問；有保險就直接由保險處理，不必動用人脈
      const crisisPreview = previewCrisisCost(player, card);
      if (player.stats.network >= 3 && !player.stats.networkCrisisSkipUsed && !crisisPreview.wasInsured) {
        const decision = await waitForCardDecision(socket, gs, player, 'crisis', '危機應對', { event: 'crisisNTSkipAvailable', payload: {
          card, timeoutMs: 0, controlledByHost: true,
          preview: { effectiveCost: crisisPreview.effectiveCost, turnsLost: crisisPreview.baseTurns, deathRisk: crisisPreview.deathRisk,
            insurable: card.requiredInsurance !== 'none', insuredCost: card.insuredCost, cash: player.cash },
        } });

        if (decision?.useNTSkip === true) {
          player.stats.networkCrisisSkipUsed = true;
          emitToRoom(roomId, 'cardApplied', {
            playerId: player.id,
            squareType,
            effect: { type: 'crisisSkippedByNT', card },
          });
          break;
        }
      }

      const _crCB = player.cash; const _crFB = player.monthlyCashflow; const _crNWB = calcNetWorth(player);
      const result = await applyCrisisWithRescue(socket, gs, player, card, '危機事件');
      emitToRoom(roomId, 'cardApplied', { playerId: player.id, squareType, effect: result });
      logPlayerEvent(player, gs, 'crisis', `危機事件：${card.title}`, _crCB, _crFB, _crNWB, { cardId: card.id, cardTitle: card.title, deathTriggered: result.deathTriggered });

      if (result.deathTriggered) {
        const { deathAge, finalScore } = eliminatePlayer(
          player,
          gs,
          'crisis',
          `危機事件「${card.title}」導致死亡`,
        );

        console.log(`[crisis] ${player.name}（${roomId}）死亡（${deathAge} 歲），評分：${finalScore.total}`);
      }
      break;
    }

    case SquareType.Relationship: {
      const relCard = RELATIONSHIP_EVENTS[Math.floor(Math.random() * RELATIONSHIP_EVENTS.length)];

      if (relCard.effect.triggerMarriageWindow && !player.isMarried) {
        emitCellEvent(socket, roomId, player.name, '人際關係', `🤝 ${relCard.title}：${relCard.description}`);
        const cashBefore = player.cash;
        const cashflowBefore = player.monthlyCashflow;
        const netWorthBefore = calcNetWorth(player);
        applyRelationshipCard(player, relCard);
        logPlayerEvent(player, gs, 'relationship', `人際關係：${relCard.title}`, cashBefore, cashflowBefore, netWorthBefore, {
          cardId: relCard.id,
          cardTitle: relCard.title,
          category: relCard.eventCategory,
        });
        startMarriageScene(gs, player, 'window');
        break;
      }

      // ── 機遇型事件：由主持人控制決策階段 ──
      if (relCard.eventCategory === 'opportunity') {
        emitCellEvent(socket, roomId, player.name, '人際關係', `🤝 ${relCard.title}：${player.name} 正在手機上決定是否接受。`);
        const relDecision = await waitForCardDecision(socket, gs, player, 'relationship', '人際關係決策', { event: 'relationshipCardDrawn', payload: {
          card: relCard,
          playerCash: player.cash,
          timeoutMs: 0,
          controlledByHost: true,
        } });
        // 主持人略過或玩家沒有送出時一律視為「婉拒」，避免賭注類卡在玩家不知情下自動執行。
        const accepted = relDecision?.accept === true;

        if (!accepted) {
          emitToRoom(roomId, 'cardApplied', { playerId: player.id, playerName: player.name, squareType, effect: { type: 'relationshipDeclined', card: relCard } });
          emitCellEvent(socket, roomId, player.name, '人際關係', `🤝 ${player.name} 婉拒了「${relCard.title}」。`);
          break;
        }

        // rel-004 擲骰賭注型：伺服器自動擲骰
        const diceResult = relCard.effect.gambleSuccess ? Math.ceil(Math.random() * 6) : undefined;

        const _relCB = player.cash; const _relFB = player.monthlyCashflow; const _relNWB = calcNetWorth(player);
        const relResult = applyRelationshipCard(player, relCard, diceResult);

        // 薪資倍率暫時效果：交給 triggerPayday 在接下來 N 個月套用（不直接改 salary，避免被月結重算覆蓋）
        if (relResult.salaryMultiplier !== undefined && relResult.turnsAffected) {
          player.salaryMultiplierPending = relResult.salaryMultiplier;
          player.salaryMultiplierMonths = Math.max(player.salaryMultiplierMonths, relResult.turnsAffected);
        }

        emitToRoom(roomId, 'cardApplied', { playerId: player.id, playerName: player.name, squareType, effect: { ...relResult, card: relCard } });
        emitCellEvent(socket, roomId, player.name, '人際關係', `🤝 ${relResult.message}`);
        logPlayerEvent(player, gs, 'relationship', `人際關係：${relCard.title}`, _relCB, _relFB, _relNWB, { cardId: relCard.id, cardTitle: relCard.title, category: relCard.eventCategory });

        // SmallDeal 額外抽牌（rel-002 同學會重聚）：走正式的小交易決策，現金購買
        if (relResult.triggerSmallDeal) {
          const bonusOriginal = gs.smallDealDeck.draw();
          const bonusDeal = bonusOriginal ? scaleDealCard(bonusOriginal, dealScaleFor(player)) : undefined;
          if (bonusDeal && bonusOriginal) {
            const dealDecision = await waitForCardDecision(socket, gs, player, 'deal', '同學會帶來的小交易', { event: 'dealCardsDrawn', payload: {
              cards: [{
                id: bonusDeal.id,
                name: bonusDeal.title,
                description: bonusDeal.description,
                downPayment: bonusDeal.asset.downPayment ?? bonusDeal.asset.cost,
                monthlyCashflow: bonusDeal.asset.monthlyCashflow,
              }],
              canPickTwo: false,
              playerCash: player.cash,
              creditScore: player.creditScore,
              loanAvailable: 0,
              bonusDeal: true,
            } });
            const bonusDown = bonusDeal.asset.downPayment ?? bonusDeal.asset.cost ?? 0;
            if (dealDecision?.accepted === true && player.cash >= bonusDown) {
              const _bdCB = player.cash; const _bdFB = player.monthlyCashflow; const _bdNWB = calcNetWorth(player);
              acceptDealCard(player, bonusDeal);
              logPlayerEvent(player, gs, 'asset_buy', `同學會小交易：${bonusDeal.title}`, _bdCB, _bdFB, _bdNWB, { cardId: bonusDeal.id, cardTitle: bonusDeal.title, monthlyCashflow: bonusDeal.asset.monthlyCashflow });
              emitToRoom(roomId, 'cardApplied', { playerId: player.id, playerName: player.name, squareType: SquareType.SmallDeal, effect: { type: 'dealAccepted', card: bonusDeal } });
              emitCellEvent(socket, roomId, player.name, '小交易', `📋 ${player.name} 透過同學會買下「${bonusDeal.title}」。`);
            } else {
              if (dealDecision?.accepted === true) {
                emitClient(socket, 'squareLandingNotice', { cellName: '小交易', message: `現金不足，無法買下「${bonusDeal.title}」（需 $${bonusDown.toLocaleString()}）。` });
              }
              emitToRoom(roomId, 'cardApplied', { playerId: player.id, playerName: player.name, squareType: SquareType.SmallDeal, effect: { type: 'dealDeclined' } });
            }
            gs.smallDealDeck.discard(bonusOriginal);
          }
        }

      } else {
        // ── 自動型（positive / negative）：直接套用並廣播 ──
        const _relCB = player.cash; const _relFB = player.monthlyCashflow; const _relNWB = calcNetWorth(player);
        const relResult = applyRelationshipCard(player, relCard);
        if (relResult.salaryMultiplier !== undefined && relResult.turnsAffected) {
          player.salaryMultiplierPending = relResult.salaryMultiplier;
          player.salaryMultiplierMonths = Math.max(player.salaryMultiplierMonths, relResult.turnsAffected);
        }

        const parts: string[] = [];
        if (relResult.cashChange !== 0) parts.push(`現金 ${relResult.cashChange > 0 ? '+' : '-'}$${Math.abs(relResult.cashChange).toLocaleString()}`);
        if (relResult.networkDelta !== 0) parts.push(`人脈 ${relResult.networkDelta > 0 ? '+' : ''}${relResult.networkDelta}`);
        if (relResult.lifeExpGain > 0) parts.push(`體驗 +${relResult.lifeExpGain}`);
        if (relResult.monthlyCashflowDelta !== 0) parts.push(`月現金流 ${relResult.monthlyCashflowDelta > 0 ? '+' : ''}$${relResult.monthlyCashflowDelta.toLocaleString()}`);
        if (relResult.salaryMultiplier !== undefined && relResult.turnsAffected) parts.push(`薪資 ×${relResult.salaryMultiplier}（${relResult.turnsAffected} 個月）`);
        const summary = parts.length > 0 ? `（${parts.join('、')}）` : '';
        emitToRoom(roomId, 'cardApplied', { playerId: player.id, playerName: player.name, squareType, effect: { ...relResult, card: relCard } });
        emitCellEvent(socket, roomId, player.name, '人際關係', `🤝 ${player.name}：${relCard.title}${summary}`);
        logPlayerEvent(player, gs, 'relationship', `人際關係：${relCard.title}`, _relCB, _relFB, _relNWB, { cardId: relCard.id, cardTitle: relCard.title, category: relCard.eventCategory });
      }
      break;
    }

    default:
      emitCellEvent(socket, roomId, player.name, '普通格子', '✅ 本格無特殊事件，平安通過。');
      break;
  }
}
