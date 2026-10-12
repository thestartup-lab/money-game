import type { Socket } from 'socket.io';
import type { GameState, Player } from './gameDataModels';
import { INNER_NODES, OUTER_NODES, nextInnerNode } from './frontend/src/boardLayout';
import { waitForCardDecision } from './decisionPhases';
import { emitToRoom } from './socketServer';
import { serializeGameState } from './playerView';

export interface BoardChoice { id: string; label: string; description: string; disabled?: boolean; group?: string }
export async function chooseBoardAction(socket: Socket, gs: GameState, player: Player, title: string, description: string, options: BoardChoice[]) {
  const answer = await waitForCardDecision(socket, gs, player, 'relationship', title,
    { event: 'boardChoiceRequired', payload: { title, description, options } });
  return options.find(o => o.id === answer?.choiceId && !o.disabled)?.id ?? null;
}

// Move along actual graph edges, never through the unchosen branch.
export async function moveBoardJourney(socket: Socket, gs: GameState, player: Player, steps: number): Promise<number[]> {
  const path: number[] = [];
  const outer = player.isInFastTrack;
  let position = outer ? player.fastTrackPosition : player.currentPosition;
  for (let i = 0; i < steps; i++) {
    if (!outer && (position === 3 || position === 13)) {
      if (!player.boardDirection) player.boardDirection = await chooseDirection(socket, gs, player);
      position = nextInnerNode(position, player.boardDirection);
      player.boardDirection = undefined;
    } else position = outer ? (position + 1) % 17 : nextInnerNode(position);
    path.push(position);
    if (outer) player.fastTrackPosition = position;
    else {
      player.currentPosition = position;
      if (position === 23) player.hasPassedSecondLife = true;
    }
    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
    await new Promise(resolve => setTimeout(resolve, 240));
    const node = (outer ? OUTER_NODES : INNER_NODES)[position];
    if (node[1] === 'service' && i < steps - 1) {
      const choice = await chooseBoardAction(socket, gs, player, '路過生活服務站', `還有 ${steps - i - 1} 步。停下可辦理一項服務，剩餘步數作廢。`, [
        { id: 'stop', label: '停下辦理服務', description: '結束本次移動，選擇一項服務。' },
        { id: 'continue', label: '繼續前進', description: '保留剩餘步數，本次不辦理服務。' },
      ]);
      if (choice === 'stop') break;
    }
  }
  if (!outer && (position === 3 || position === 13)) player.boardDirection = await chooseDirection(socket, gs, player);
  return path;
}

async function chooseDirection(socket: Socket, gs: GameState, player: Player): Promise<'career' | 'life'> {
  const choice = await chooseBoardAction(socket, gs, player, '人生選路', '兩條路線長度相同，選擇接下來想遇到的機會。', [
    { id: 'career', label: '事業方向', description: '職涯、投資與合作機會。' },
    { id: 'life', label: '生活方向', description: '健康、體驗與家庭機會。' },
  ]);
  return choice === 'life' ? 'life' : 'career';
}
