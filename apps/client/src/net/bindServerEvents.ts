import type {
  RoundEndPayload,
  ScoreboardPayload,
  LifelineToastPayload,
  PauseResumePayload,
  StrikePayload,
  ErrorPayload,
  SessionIdentityPayload,
  SessionRemovedPayload,
} from '@bomb-squad/shared';
import type { TimerState } from '@bomb-squad/shared';
import type { AppClientSocket } from './socket.js';
import { noteTimerBroadcast, resetClockOffset } from './serverClock.js';
import { setIdentity, clearIdentity } from './identity.js';
import { useGameStore } from '../store/gameStore.js';

/**
 * Registers typed handlers for all ServerToClientEvents on the given socket.
 * Returns an unsubscribe function that removes exactly the handlers registered
 * here — never listeners owned by other modules or socket.io internals.
 */
export function bindServerEvents(socket: AppClientSocket): () => void {
  const { setSession, setBomb, applyModuleUpdate, setTimer, setStrike, setResolution, setScoreboard, setConnection, clearSession, setMyPlayerId } =
    useGameStore.getState();

  const onBombDefused = (payload: RoundEndPayload) => {
    setResolution({ outcome: 'defused', elapsedMs: payload.elapsedMs });
  };
  // BOMB_EXPLODED covers both failure outcomes. DETONATED (3rd strike) vs TIME
  // EXPIRED (clock hit 0) is a client-side label — derived from the strike count
  // in the non-authoritative bomb snapshot, the simplest correct mapping with the
  // data on hand (no third event; Task 1). LIMITATION: this depends on the client
  // having received the terminal strike count; until Story 4.7's interaction
  // handler broadcasts the strike-3 bomb state, a 3rd-strike loss may fall back to
  // the TIME EXPIRED label. Acceptable for V1.
  const onBombExploded = (payload: RoundEndPayload) => {
    const strikes = useGameStore.getState().bomb?.strikes ?? 0;
    const outcome = strikes >= 3 ? 'exploded' : 'time-expired';
    setResolution({ outcome, elapsedMs: payload.elapsedMs });
  };
  // Between-rounds scoreboard preview (Story 8.6). The server emits this only on
  // entering 'between-rounds' (every team resolved), alongside a 'between-rounds'
  // SESSION_STATE — so it never arrives mid-round (AC-3). The Scoreboard surface
  // derives its render from session.teams (reconnect-safe); this populates the
  // explicit preview signal.
  const onScoreboard = (payload: ScoreboardPayload) => {
    setScoreboard(payload);
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
  // A strike-driven rebase rides inside STRIKE (no separate TIMER_UPDATE), so the
  // freshly server-stamped `startedAt` it carries is the only offset refresh on a
  // strike-heavy round — feed it to the estimator (no-op when paused) before
  // storing, same posture as onTimerUpdate, or serverNow() drifts (decision 9).
  const onStrike = (payload: StrikePayload) => {
    noteTimerBroadcast(payload.timer);
    setStrike(payload);
  };
  const onResumed = (payload: PauseResumePayload) => {
    console.info('[socket] RESUMED', payload);
  };
  const onError = (payload: ErrorPayload) => {
    console.error('[socket] ERROR', payload);
  };
  // Durable identity (Story 2.7): persist the private packet so a refresh can
  // re-attach via the handshake auth. AR15: the token is a secret — never log it.
  const onIdentity = (payload: SessionIdentityPayload) => {
    setIdentity(payload);
    // Reactively record the durable playerId so the "You" tag / role routing
    // update immediately on first join (a sessionStorage write is not reactive).
    setMyPlayerId(payload.playerId);
    // Keep the live socket's auth current so an auto-reconnect replays the token.
    socket.auth = { sessionId: payload.sessionId, reattachToken: payload.reattachToken };
  };
  // The facilitator removed this client: forget the identity, drop to Landing,
  // and carry the human-readable notice across the remount.
  const onRemoved = (payload: SessionRemovedPayload) => {
    clearIdentity();
    socket.auth = {};
    clearSession(payload.message);
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
  socket.on('SESSION_IDENTITY', onIdentity);
  socket.on('SESSION_REMOVED', onRemoved);
  socket.on('BOMB_INIT', setBomb);
  socket.on('MODULE_UPDATE', applyModuleUpdate);
  socket.on('TIMER_UPDATE', onTimerUpdate);
  socket.on('STRIKE', onStrike);

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
    socket.off('SESSION_IDENTITY', onIdentity);
    socket.off('SESSION_REMOVED', onRemoved);
    socket.off('BOMB_INIT', setBomb);
    socket.off('MODULE_UPDATE', applyModuleUpdate);
    socket.off('TIMER_UPDATE', onTimerUpdate);
    socket.off('STRIKE', onStrike);
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
