import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import type { GameState, Player, PlayerAnalysis, RoomPlayerSummary } from '../types/game';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

export interface UseGameStateReturn {
  socket: Socket | null;
  connected: boolean;
  gameState: GameState | null;
  myPlayer: Player | null;
  error: string | null;
  analysis: PlayerAnalysis | null;
  roomAnalysis: { roomId: string; players: RoomPlayerSummary[]; currentAge: number } | null;
  emit: (event: string, ...args: unknown[]) => void;
  clearError: () => void;
}

export function useGameState(mySocketId: string | null): UseGameStateReturn {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<PlayerAnalysis | null>(null);
  const [roomAnalysis, setRoomAnalysis] = useState<UseGameStateReturn['roomAnalysis']>(null);

  useEffect(() => {
    const s = io(SERVER_URL, { transports: ['websocket'] });
    socketRef.current = s;

    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));

    s.on('gameStateUpdate', (state: GameState) => setGameState(state));
    s.on('error', (payload: { message: string }) => setError(payload.message));
    s.on('playerAnalysis', (data: PlayerAnalysis) => setAnalysis(data));
    s.on('roomAnalysis', (data: UseGameStateReturn['roomAnalysis']) => setRoomAnalysis(data));

    return () => { s.disconnect(); };
  }, []);

  const emit = (event: string, ...args: unknown[]) => {
    socketRef.current?.emit(event, ...args);
  };

  const myPlayer = gameState?.players.find((p) => p.id === (socketRef.current?.id ?? mySocketId)) ?? null;

  return {
    socket: socketRef.current,
    connected,
    gameState,
    myPlayer,
    error,
    analysis,
    roomAnalysis,
    emit,
    clearError: () => setError(null),
  };
}
