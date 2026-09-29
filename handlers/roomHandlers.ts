/** 房間、主持人登入、大螢幕、玩家加入與重連（由 socketServer 註冊到每條連線） */
import type { Socket } from 'socket.io';
import { randomBytes } from 'crypto';
import { Server } from 'socket.io';
import { GameState, GamePhase } from '../gameDataModels';
import { createPlayer, getAvailableProfessions } from '../gameLogic';
import { SOCIAL_CLASS_CONFIG } from '../gameConfig';
import {
  MAX_ACTIVE_ROOMS, OnSafe, addRoomAdmin, adminLoginRate, cancelEmptyRoomCleanup, consumeRateLimit,
  continueAfterTurnAdvance, createRoomAdminCredential, emitClient, emitToRoom, forgetPersistedRoom, generateRoomCode,
  getPlayerSocket, getRoomState, hasRoomAdmin, io, isRoomAdmin, maybeCompleteActionPhase,
  pendingSubmissions, playerIdentity, playerSessions, privateReplay, removeRoomAdmin, roomAdminCredentials,
  roomAdminSocketIds, roomCreationRate, rooms, scheduleEmptyRoomCleanup, serializeGameState, skipCurrentEducationTurns, payCompletedRounds,
  socketRoomMap, tryOpenWorldEvent, verifyRoomAdminPassword,
  repairCurrentTurn,
} from '../socketServer';

export function registerRoomHandlers(socket: Socket, onSafe: OnSafe): void {

  // ----------------------------------------------------------
  // 主持人：建立房間 (createRoom)
  // ----------------------------------------------------------
  /**
   * 新房自動產生專屬主持人控制碼，只回傳給建立者。
   * Client → Server: { roomId?: string }
   * Server → Caller: roomCreated { roomId, joinCode } | error
   *
   * 建立新的獨立遊戲房間，回傳給主持人的 joinCode 供玩家加入使用。
   * 同一主持人可建立多個房間（多開場次）。
   */
  onSafe('createRoom', (payload?: { roomId?: string }) => {
    const rateKey = socket.handshake.address || playerIdentity(socket);
    if (!consumeRateLimit(roomCreationRate, rateKey, 5, 10 * 60 * 1000)) {
      emitClient(socket, 'error', { message: '建立房間次數過多，請稍後再試。' });
      return;
    }
    if (rooms.size >= MAX_ACTIVE_ROOMS) {
      emitClient(socket, 'error', { message: '目前房間已達上限，請稍後再試。' });
      return;
    }
    const customCode = payload?.roomId?.trim().toUpperCase();
    if (customCode) {
      if (rooms.has(customCode)) {
        emitClient(socket, 'error', { message: `房間代碼「${customCode}」已存在，請換一個。` });
        return;
      }
      if (!/^[A-Z0-9]{4,6}$/.test(customCode)) {
        emitClient(socket, 'error', { message: '房間代碼只能包含英文字母與數字，長度 4–6 碼。' });
        return;
      }
    }
    const roomCode = customCode || generateRoomCode();
    const gs = new GameState(roomCode);
    gs.adminSocketId = playerIdentity(socket);
    const adminCode = randomBytes(6).toString('hex').toUpperCase();
    roomAdminCredentials.set(roomCode, createRoomAdminCredential(adminCode));
    rooms.set(roomCode, gs);
    addRoomAdmin(roomCode, playerIdentity(socket));
    cancelEmptyRoomCleanup(roomCode);

    // 主持人也加入 Socket.io 房間（可接收廣播）
    socket.join(roomCode);
    socketRoomMap.set(playerIdentity(socket), roomCode);

    console.log(`[createRoom] 主持人 ${playerIdentity(socket)} 建立房間：${roomCode}（目前共 ${rooms.size} 個房間）`);

    emitClient(socket, 'roomCreated', {
      roomId: roomCode,
      joinCode: roomCode,
      adminCode,
      adminSocketId: playerIdentity(socket),
    });
    // 立即推送初始遊戲狀態（WaitingForPlayers），讓後台能正確顯示開始按鈕
    emitClient(socket, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 主持人：刪除房間 (deleteRoom)
  // ----------------------------------------------------------
  /**
   * Admin only（需已在該房間）。
   * Client → Server: {}
   * Server → All in room: roomDeleted
   * Server → Caller: deleteRoomResult
   */
  onSafe('deleteRoom', () => {
    const gs = getRoomState(socket);
    if (!gs) {
      emitClient(socket, 'error', { message: '尚未加入任何房間。' });
      return;
    }
    if (!isRoomAdmin(socket, gs)) {
      emitClient(socket, 'error', { message: '只有建立此房間的主持人才能刪除它。' });
      return;
    }
    if (gs.decisionPhase || gs.facilitatorScene || gs.turnInProgress || gs.globalPaydayInProgress) {
      emitClient(socket, 'error', { message: '請先由主持人結束目前的決策階段，再關閉房間。' });
      return;
    }

    const roomId = gs.gameId;
    cancelEmptyRoomCleanup(roomId);
    rooms.delete(roomId);
    roomAdminCredentials.delete(roomId);
    roomAdminSocketIds.delete(roomId);
    forgetPersistedRoom(roomId);

    for (const [id, session] of playerSessions) if (session.roomId === roomId) {
      playerSessions.delete(id);
      privateReplay.delete(id);
      pendingSubmissions.delete(id);
      io.in(id).socketsLeave(id);
    }

    // 先移除房間再通知前端，避免前端收到 roomDeleted 後立刻刷新清單時
    // 又讀到尚未刪除的舊房間。
    emitToRoom(roomId, 'roomDeleted', { roomId, reason: '主持人已關閉房間。' });

    // 踢出所有在此房間的 socket
    io.in(roomId).socketsLeave(roomId);

    // 清理 socketRoomMap 中屬於此房間的紀錄
    for (const [sid, rid] of socketRoomMap) {
      if (rid === roomId) socketRoomMap.delete(sid);
    }

    console.log(`[deleteRoom] 房間 ${roomId} 已刪除（目前剩 ${rooms.size} 個房間）`);
    emitClient(socket, 'deleteRoomResult', { success: true, roomId });
  });

  // ----------------------------------------------------------
  // 管理員登入現有房間 (adminLogin)
  // ----------------------------------------------------------
  /**
   * 主持人重新連線時，重新取得指定房間的管理員身份。
   * Client → Server: { password: string, roomId: string }
   * Server → Caller: adminLoginSuccess | adminLoginFail
   */
  onSafe('adminLogin', (payload: { password: string; roomId?: string }) => {
    const targetRoomId = payload?.roomId?.trim().toUpperCase();
    if (!targetRoomId) {
      emitClient(socket, 'adminLoginFail', { message: '請輸入房間代碼。' });
      return;
    }
    const rateKey = `${socket.handshake.address || playerIdentity(socket)}:${targetRoomId}`;
    if (!consumeRateLimit(adminLoginRate, rateKey, 10, 5 * 60 * 1000)) {
      emitClient(socket, 'adminLoginFail', { message: '登入嘗試次數過多，請五分鐘後再試。' });
      return;
    }

    const gs = rooms.get(targetRoomId);
    if (!gs) {
      emitClient(socket, 'adminLoginFail', { message: `房間 ${targetRoomId} 不存在。` });
      return;
    }
    if (!verifyRoomAdminPassword(targetRoomId, payload?.password ?? '')) {
      emitClient(socket, 'adminLoginFail', { message: '房間代碼或主持人密碼錯誤。' });
      return;
    }
    adminLoginRate.delete(rateKey);

    const previousRoomId = socketRoomMap.get(playerIdentity(socket));
    if (previousRoomId && previousRoomId !== targetRoomId) {
      const previousRoom = rooms.get(previousRoomId);
      if (previousRoom && isRoomAdmin(socket, previousRoom)) {
        removeRoomAdmin(previousRoomId, playerIdentity(socket));
        scheduleEmptyRoomCleanup(previousRoomId);
      }
      socket.leave(previousRoomId);
    }

    addRoomAdmin(targetRoomId, playerIdentity(socket));
    cancelEmptyRoomCleanup(targetRoomId);
    socket.join(targetRoomId);
    socketRoomMap.set(playerIdentity(socket), targetRoomId);

    console.log(`[adminLogin] 主持人重新登入房間 ${targetRoomId}：${playerIdentity(socket)}`);
    emitClient(socket, 'adminLoginSuccess', { adminSocketId: playerIdentity(socket), roomId: targetRoomId, adminCode: payload.password });
    // 登入後立即推送當前遊戲狀態，讓後台能正確顯示開始按鈕
    emitClient(socket, 'gameStateUpdate', serializeGameState(gs));
  });

  // 手機控場切換房間時主動釋放管理員身份，避免空房被誤判仍有人控制。
  onSafe('adminLeaveRoom', () => {
    const roomId = socketRoomMap.get(playerIdentity(socket));
    const gs = roomId ? rooms.get(roomId) : undefined;
    if (!roomId || !gs || !isRoomAdmin(socket, gs)) return;
    removeRoomAdmin(roomId, playerIdentity(socket));
    socketRoomMap.delete(playerIdentity(socket));
    socket.leave(roomId);
    scheduleEmptyRoomCleanup(roomId);
    emitClient(socket, 'adminLeftRoom', { roomId });
  });

  // ----------------------------------------------------------
  // 展示頁加入觀看 (joinDisplay) — 不需密碼，只讀取遊戲狀態
  // ----------------------------------------------------------
  onSafe('joinDisplay', (payload: { roomId: string }) => {
    const targetRoomId = payload?.roomId?.trim().toUpperCase();
    if (!targetRoomId) {
      emitClient(socket, 'joinDisplayFail', { message: '請輸入房間代碼。' });
      return;
    }
    const gs = rooms.get(targetRoomId);
    if (!gs) {
      emitClient(socket, 'joinDisplayFail', { message: `房間「${targetRoomId}」不存在，請確認代碼。` });
      return;
    }
    socket.join(targetRoomId);
    socketRoomMap.set(playerIdentity(socket), targetRoomId);
    emitClient(socket, 'joinDisplaySuccess', { roomId: targetRoomId });
    emitClient(socket, 'gameStateUpdate', serializeGameState(gs));
    console.log(`[joinDisplay] 展示頁加入房間 ${targetRoomId}：${playerIdentity(socket)}`);
  });

  // ----------------------------------------------------------
  // 查詢可加入的房間列表 (listRooms)
  // ----------------------------------------------------------
  /**
   * Client → Server: {}
   * Server → Caller: roomList [{ roomId, playerCount, gamePhase }]
   *
   * 供玩家確認房間代碼存在，或主持人確認房間狀態。
   */
  onSafe('listRooms', () => {
    const list = Array.from(rooms.entries()).map(([roomId, gs]) => ({
      roomId,
      playerCount: gs.players.size,
      gamePhase: gs.gamePhase,
      hasAdmin: hasRoomAdmin(gs),
    }));
    emitClient(socket, 'roomList', list);
  });

  // ----------------------------------------------------------
  // 玩家加入 (playerJoin)
  // ----------------------------------------------------------
  /**
   * Client → Server: { playerName: string, roomCode: string, professionId?: string }
   *
   * 玩家透過主持人分享的 roomCode 加入對應房間。
   * roomCode 是建立房間時回傳的 6 字元代碼。
   * 已有角色必須透過 playerRejoin 與續玩憑證恢復，不能僅靠名字接管。
   */
  onSafe(
    'playerJoin',
    (payload: { playerName: string; roomCode: string; professionId?: string }) => {
      const { playerName, roomCode, professionId } = payload;

      const gs = rooms.get(roomCode);
      if (!gs) {
        emitClient(socket, 'error', { message: `房間代碼「${roomCode}」不存在，請確認後再試。` });
        return;
      }
      cancelEmptyRoomCleanup(roomCode);

      if (gs.gamePhase === GamePhase.GameOver) {
        emitClient(socket, 'error', { message: '此房間的遊戲已結束，無法加入。' });
        return;
      }

      if (socketRoomMap.has(playerIdentity(socket))) {
        emitClient(socket, 'error', { message: '你已加入房間，請先離開原房間。' }); return;
      }
      if ([...gs.players.values()].some(p => p.name === playerName.trim())) {
        emitClient(socket, 'error', { message: '此名字已被使用。原玩家請用原裝置重新連線。' }); return;
      }
      if (![GamePhase.WaitingForPlayers, GamePhase.Pre20].includes(gs.gamePhase)) {
        emitClient(socket, 'error', { message: '遊戲已開始，請等待下一場再加入。' }); return;
      }

      // ── 全新玩家加入 ──────────────────────────────────────────
      // 加入 Socket.io 房間與映射表
      socket.join(roomCode);
      socketRoomMap.set(playerIdentity(socket), roomCode);

      console.log(
        `[playerJoin] ${playerName}（socket: ${playerIdentity(socket)}）加入房間 ${roomCode}，職業指定：${professionId ?? '隨機'}`
      );

      // 職業一律由 Pre-20 流程決定；客戶端指定的 professionId 只當作偏好記錄，不直接套用（否則可帶入高 FQ 職業白拿財商值）
      void professionId;
      const player = createPlayer(playerIdentity(socket), playerName.trim());
      socket.data.playerId = player.id;
      socket.join(player.id);
      const token = randomBytes(32).toString('hex');
      playerSessions.set(player.id, { roomId: roomCode, token, socketId: socket.id });
      gs.addPlayer(player);
      emitClient(socket, 'playerSession', { playerId: player.id, reconnectToken: token, roomCode, playerName: player.name });

      // 第一位玩家加入後，進入 Pre-20 設定階段
      if (gs.gamePhase === GamePhase.WaitingForPlayers) {
        gs.gamePhase = GamePhase.Pre20;
        console.log(`[playerJoin] 房間 ${roomCode} 進入 Pre-20 階段`);
      }

      // 若是第一位玩家，設定為當前回合玩家
      if (gs.playerOrder.length === 1) {
        gs.currentPlayerTurnId = playerIdentity(socket);
      }

      console.log(
        `[playerJoin] ${playerName} 職業：${player.profession.name}，` +
          `起始現金：$${player.cash}，月現金流：$${player.monthlyCashflow}`
      );

      emitToRoom(roomCode, 'gameStateUpdate', serializeGameState(gs));
    }
  );

  // ----------------------------------------------------------
  // 時鐘控制事件（主持人專用）
  // ----------------------------------------------------------

  // ----------------------------------------------------------
  // 主持人踢出玩家 (kickPlayer) — 主要用於清除卡在設定階段或長期斷線的玩家
  // ----------------------------------------------------------
  onSafe('kickPlayer', (payload: { playerId: string }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    if (!isRoomAdmin(socket, gs)) {
      emitClient(socket, 'error', { message: '只有管理員可以踢出玩家。' });
      return;
    }

    const target = gs.players.get(payload.playerId);
    if (!target) {
      emitClient(socket, 'error', { message: '找不到該玩家。' });
      return;
    }

    const wasCurrentTurn = gs.currentPlayerTurnId === payload.playerId;
    if (gs.decisionPhase || gs.facilitatorScene || gs.turnInProgress || gs.globalPaydayInProgress) {
      emitClient(socket, 'error', { message: '請先收束目前決策，再移除玩家。' }); return;
    }
    if (target.assets.some(a => a.id.startsWith('p2p-')) || target.liabilities.some(l => l.id.startsWith('p2p-'))) {
      emitClient(socket, 'error', { message: '此玩家仍有玩家借貸，請先結清，以免另一方帳目遺失。' }); return;
    }
    const targetSocket = getPlayerSocket(target.id);
    targetSocket?.leave(target.id);
    targetSocket?.leave(roomId);
    socketRoomMap.delete(target.id);
    playerSessions.delete(target.id);
    privateReplay.delete(target.id);
    targetSocket?.emit('playerKicked', { playerId: target.id, playerName: target.name });
    const inPlay = gs.gamePhase === GamePhase.RatRace || gs.gamePhase === GamePhase.FastTrack;
    if (wasCurrentTurn && inPlay && gs.playerOrder.length > 1) {
      // 先在原順序上找出下一位，再移除；否則 indexOf 得到 -1 會讓輪次跳回第一位。
      gs.advanceToNextTurn();
    }
    gs.removePlayer(payload.playerId);
    // 開局前移除第一位加入者時也要換人，否則開局後沒有人能擲骰
    if (wasCurrentTurn) repairCurrentTurn(gs);
    if (wasCurrentTurn && inPlay && gs.playerOrder.length > 0) {
      skipCurrentEducationTurns(gs);
      payCompletedRounds(gs);
      continueAfterTurnAdvance(gs);
      tryOpenWorldEvent(gs);
    }

    console.log(`[kickPlayer] 主持人移除玩家 ${target.name}（${roomId}）`);
    emitToRoom(roomId, 'playerKicked', { playerId: payload.playerId, playerName: target.name });
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 客戶端斷線 (disconnect)
  // ----------------------------------------------------------
  onSafe('disconnect', () => {
    if (socket.data.playerId && playerSessions.get(playerIdentity(socket))?.socketId !== socket.id) return;
    console.log(`[斷線] 客戶端離線：${playerIdentity(socket)}`);

    const roomId = socketRoomMap.get(playerIdentity(socket));
    socketRoomMap.delete(playerIdentity(socket));

    if (!roomId) return;

    const gs = rooms.get(roomId);
    if (!gs) return;

    // 若斷線的是管理員，清除管理員狀態（玩家資料保留，等待重新登入）
    if (isRoomAdmin(socket, gs)) {
      removeRoomAdmin(roomId, playerIdentity(socket));
      console.log(`[斷線] 房間 ${roomId} 管理員離線，等待重新登入`);
      scheduleEmptyRoomCleanup(roomId);
    }

    const player = gs.players.get(playerIdentity(socket));
    if (player) {
      // 保留角色；所有人離線後才啟動整房閒置清理。
      player.isDisconnected = true;
      console.log(`[斷線] 玩家 ${player.name} 斷線，保留角色等待原裝置重連`);
      maybeCompleteActionPhase(gs);
      emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));

      // Preserve disconnected characters until the host explicitly removes them.
    }

    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));

    // 任何階段只要無主持人且無玩家，30 分鐘後都會自動清除。
    scheduleEmptyRoomCleanup(roomId);
  });

  // ----------------------------------------------------------
  // 玩家重連恢復 (playerRejoin)
  // ----------------------------------------------------------
  onSafe('playerRejoin', (payload: { playerName: string; roomCode: string; reconnectToken: string }) => {
    const gs = rooms.get(payload.roomCode);
    const entry = [...playerSessions.entries()].find(([, session]) =>
      session.roomId === payload.roomCode && session.token === payload.reconnectToken);
    const player = entry && gs?.players.get(entry[0]);
    if (!gs || !entry || !player || player.name !== payload.playerName) {
      socket.emit('rejoinFailed', { message: '無法驗證續玩身分，請使用原裝置，或請主持人協助。' }); return;
    }
    if (socketRoomMap.has(playerIdentity(socket)) && playerIdentity(socket) !== player.id) {
      socket.emit('rejoinFailed', { message: '此裝置已加入其他角色。' }); return;
    }
    const oldSocket = getPlayerSocket(player.id);
    entry[1].socketId = socket.id;
    socket.data.playerId = player.id;
    if (oldSocket && oldSocket !== socket) {
      // 先告知舊頁面已被接手，再切斷；否則舊頁面只會安靜地失去反應。
      oldSocket.emit('sessionTakenOver', { playerName: player.name, message: '你的角色已在另一個頁面或裝置繼續，本頁面已停止。' });
      oldSocket.disconnect(true);
    }
    socket.join(player.id);
    socket.join(gs.gameId);
    socketRoomMap.set(player.id, gs.gameId);
    player.isDisconnected = false;
    cancelEmptyRoomCleanup(gs.gameId);
    emitClient(socket, 'playerSession', { playerId: player.id, reconnectToken: entry[1].token, roomCode: gs.gameId, playerName: player.name });
    emitClient(socket, 'rejoinSuccess', { playerId: player.id });
    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
    if (gs.gamePhase === GamePhase.Pre20) {
      if (player.pre20Done) emitClient(socket, 'professionAssigned', { profession: player.profession, quadrant: player.profession.quadrant, initialCashflow: player.monthlyCashflow });
      else if (entry[1].setupStep === 'career') emitClient(socket, 'growthStatsApplied', { stats: player.stats, availableProfessions: getAvailableProfessions(player), canContinueEducation: !player.hasContinuedEducation });
      else if (entry[1].setupStep === 'allocate') emitClient(socket, 'socialClassRolled', { socialClass: player.socialClass, label: SOCIAL_CLASS_CONFIG[player.socialClass].label, growthPoints: player.growthPointsRemaining, startingCashBonus: 0 });
    }
    if (gs.decisionPhase?.playerId === player.id || gs.decisionPhase?.playerId === '__all_players__') {
      const alreadyDone = gs.decisionPhase.playerId === '__all_players__' && gs.actionPhaseDone.has(player.id);
      if (!alreadyDone) for (const [event, args] of privateReplay.get(player.id) ?? []) socket.emit(event, ...args);
      if (gs.decisionPhase.submitted || alreadyDone) emitClient(socket, 'decisionSubmitted', { phaseId: gs.decisionPhase.id });
    }
  });
}
