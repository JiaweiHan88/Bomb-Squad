import type { AppClientSocket } from './socket.js';
import { useGameStore } from '../store/gameStore.js';
import { useUiStore } from '../store/uiStore.js';

/**
 * Registers typed handlers for all ServerToClientEvents on the given socket.
 * Returns an unsubscribe function that removes all listeners.
 */
export function bindServerEvents(socket: AppClientSocket): () => void {
  const { setSession, setBomb, applyModuleUpdate, setTimer, setStrike, setConnection } =
    useGameStore.getState();

  socket.on('SESSION_STATE', setSession);
  socket.on('BOMB_INIT', setBomb);
  socket.on('MODULE_UPDATE', applyModuleUpdate);
  socket.on('TIMER_UPDATE', setTimer);
  socket.on('STRIKE', setStrike);

  socket.on('BOMB_DEFUSED', (payload) => {
    console.info('[socket] BOMB_DEFUSED', payload);
  });
  socket.on('BOMB_EXPLODED', (payload) => {
    console.info('[socket] BOMB_EXPLODED', payload);
  });
  socket.on('SCOREBOARD', (payload) => {
    console.info('[socket] SCOREBOARD', payload);
  });
  socket.on('LIFELINE_TOAST', (payload) => {
    useUiStore.getState().setManualOpen(false);
    console.info('[socket] LIFELINE_TOAST', payload);
  });
  socket.on('PAUSED', (payload) => {
    console.info('[socket] PAUSED', payload);
  });
  socket.on('RESUMED', (payload) => {
    console.info('[socket] RESUMED', payload);
  });
  socket.on('ERROR', (payload) => {
    console.error('[socket] ERROR', payload);
  });

  socket.on('connect', () => setConnection('connected'));
  socket.on('disconnect', () => setConnection('disconnected'));
  socket.on('connect_error', () => setConnection('disconnected'));

  return () => {
    socket.off('SESSION_STATE', setSession);
    socket.off('BOMB_INIT', setBomb);
    socket.off('MODULE_UPDATE', applyModuleUpdate);
    socket.off('TIMER_UPDATE', setTimer);
    socket.off('STRIKE', setStrike);
    socket.removeAllListeners('BOMB_DEFUSED');
    socket.removeAllListeners('BOMB_EXPLODED');
    socket.removeAllListeners('SCOREBOARD');
    socket.removeAllListeners('LIFELINE_TOAST');
    socket.removeAllListeners('PAUSED');
    socket.removeAllListeners('RESUMED');
    socket.removeAllListeners('ERROR');
    socket.removeAllListeners('connect');
    socket.removeAllListeners('disconnect');
    socket.removeAllListeners('connect_error');
  };
}
