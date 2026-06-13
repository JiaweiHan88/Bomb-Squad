import type {
  RoundEndPayload,
  ScoreboardPayload,
  LifelineToastPayload,
  PauseResumePayload,
  ErrorPayload,
} from '@bomb-squad/shared';
import type { TimerState } from '@bomb-squad/shared';
import type { AppClientSocket } from './socket.js';
import { noteTimerBroadcast, resetClockOffset } from './serverClock.js';
import { useGameStore } from '../store/gameStore.js';

/**
 * Registers typed handlers for all ServerToClientEvents on the given socket.
 * Returns an unsubscribe function that removes exactly the handlers registered
 * here — never listeners owned by other modules or socket.io internals.
 */
export function bindServerEvents(socket: AppClientSocket): () => void {
  const { setSession, setBomb, applyModuleUpdate, setTimer, setStrike, setConnection } =
    useGameStore.getState();

  const onBombDefused = (payload: RoundEndPayload) => {
    console.info('[socket] BOMB_DEFUSED', payload);
  };
  const onBombExploded = (payload: RoundEndPayload) => {
    console.info('[socket] BOMB_EXPLODED', payload);
  };
  const onScoreboard = (payload: ScoreboardPayload) => {
    console.info('[socket] SCOREBOARD', payload);
  };
  const onLifelineToast = (payload: LifelineToastPayload) => {
    console.info('[socket] LIFELINE_TOAST', payload);
  };
  const onPaused = (payload: PauseResumePayload) => {
    console.info('[socket] PAUSED', payload);
  };
  // Refresh the server-clock offset before storing the segment, so the first
  // frame extrapolating the new TimerState already uses the new estimate.
  const onTimerUpdate = (timer: TimerState) => {
    noteTimerBroadcast(timer);
    setTimer(timer);
  };
  const onResumed = (payload: PauseResumePayload) => {
    console.info('[socket] RESUMED', payload);
  };
  const onError = (payload: ErrorPayload) => {
    console.error('[socket] ERROR', payload);
  };

  const onConnect = () => setConnection('connected');
  // Drop the server-clock offset on disconnect so a reconnect can't carry a
  // stale (possibly ahead-of-server) estimate (Story 8.4).
  const onDisconnect = () => {
    resetClockOffset();
    setConnection('disconnected');
  };
  const onConnectError = () => setConnection('disconnected');
  // Manager-level event: fires on every auto-reconnect attempt, so the UI
  // shows "connecting" during the retry window instead of "disconnected".
  const onReconnectAttempt = () => setConnection('connecting');

  socket.on('SESSION_STATE', setSession);
  socket.on('BOMB_INIT', setBomb);
  socket.on('MODULE_UPDATE', applyModuleUpdate);
  socket.on('TIMER_UPDATE', onTimerUpdate);
  socket.on('STRIKE', setStrike);

  socket.on('BOMB_DEFUSED', onBombDefused);
  socket.on('BOMB_EXPLODED', onBombExploded);
  socket.on('SCOREBOARD', onScoreboard);
  socket.on('LIFELINE_TOAST', onLifelineToast);
  socket.on('PAUSED', onPaused);
  socket.on('RESUMED', onResumed);
  socket.on('ERROR', onError);

  socket.on('connect', onConnect);
  socket.on('disconnect', onDisconnect);
  socket.on('connect_error', onConnectError);
  socket.io.on('reconnect_attempt', onReconnectAttempt);

  return () => {
    socket.off('SESSION_STATE', setSession);
    socket.off('BOMB_INIT', setBomb);
    socket.off('MODULE_UPDATE', applyModuleUpdate);
    socket.off('TIMER_UPDATE', onTimerUpdate);
    socket.off('STRIKE', setStrike);
    socket.off('BOMB_DEFUSED', onBombDefused);
    socket.off('BOMB_EXPLODED', onBombExploded);
    socket.off('SCOREBOARD', onScoreboard);
    socket.off('LIFELINE_TOAST', onLifelineToast);
    socket.off('PAUSED', onPaused);
    socket.off('RESUMED', onResumed);
    socket.off('ERROR', onError);
    socket.off('connect', onConnect);
    socket.off('disconnect', onDisconnect);
    socket.off('connect_error', onConnectError);
    socket.io.off('reconnect_attempt', onReconnectAttempt);
  };
}
