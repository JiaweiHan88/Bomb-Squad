import { jest } from '@jest/globals';
import type {
  SessionState,
  SessionCreatedPayload,
  ErrorPayload,
  BombState,
  ModuleUpdate,
  StrikePayload,
  StrikeCount,
} from '@bomb-squad/shared';
import { registerSessionHandlers } from '../sessionHandlers.js';
import { registerModuleHandlers } from '../moduleHandlers.js';
import { bombKey, timerKey } from '../../state/keys.js';
import {
  startTestSocketServer,
  createMemoryRedisStore,
  createTestScheduler,
  noopLog,
  type TestSocketServer,
  type TestClientSocket,
  type MemoryRedisStore,
  type TestScheduler,
} from './testSocketServer.js';

/**
 * MODULE_INTERACT handler (Story 4.7) — integration tests through a real socket
 * round-trip. The session is driven to an active round via the real
 * SESSION_CREATE → JOIN → TEAM_ASSIGN → PREPARATION_OPEN → ROUND_START flow (so
 * roles are committed and team rooms joined), then each team's bomb is replaced
 * with a CONTROLLED single-wires bomb so defuse / strike / explosion are
 * deterministic. The pure bombReducer is exercised directly — never mocked.
 */

function nextEvent<T>(socket: TestClientSocket, event: string): Promise<T> {
  return new Promise<T>((resolve) => {
    socket.once(event as 'SESSION_STATE', ((payload: T) => resolve(payload)) as never);
  });
}

function createSession(socket: TestClientSocket): Promise<SessionCreatedPayload> {
  return new Promise((resolve) => socket.emit('SESSION_CREATE', {}, resolve));
}

/** Controlled bomb: one wires module, three wires, the given correct index. */
function wiresBomb(solutionIndex: number, strikes: StrikeCount = 0): BombState {
  return {
    context: { serialNumber: 'AB1CD2', batteryCount: 0, indicators: [], ports: [] },
    modules: [
      {
        moduleId: 'wires',
        status: 'armed',
        data: {
          wires: [
            { color: 'red', cut: false },
            { color: 'blue', cut: false },
            { color: 'yellow', cut: false },
          ],
          solutionIndex,
        },
      },
    ],
    strikes,
    solved: false,
  };
}

describe('MODULE_INTERACT handler (Story 4.7)', () => {
  let server: TestSocketServer;
  let store: MemoryRedisStore;
  let scheduler: TestScheduler;
  let facilitator: TestClientSocket;
  let maya: TestClientSocket;
  let devon: TestClientSocket;

  beforeEach(async () => {
    store = createMemoryRedisStore();
    server = await startTestSocketServer((io) => {
      scheduler = createTestScheduler({ redis: store, io, log: noopLog });
      registerSessionHandlers(io, { redis: store, log: noopLog, timer: scheduler });
      registerModuleHandlers(io, { redis: store, log: noopLog, timer: scheduler });
    });
    facilitator = await server.connectClient();
    maya = await server.connectClient();
    devon = await server.connectClient();
  });

  afterEach(async () => {
    await server.close();
  });

  function idOf(state: SessionState, displayName: string): string {
    return Object.values(state.players).find((p) => p.displayName === displayName)!.playerId;
  }

  function joinAs(socket: TestClientSocket, joinCode: string, displayName: string): Promise<SessionState> {
    const statePromise = nextEvent<SessionState>(socket, 'SESSION_STATE');
    socket.emit('SESSION_JOIN', { joinCode, displayName, role: 'expert' });
    return statePromise;
  }

  /**
   * Bring the session to an active round (Maya = defuser Team A, Devon = Team B)
   * and replace Team A's bomb with `bomb`. Returns once Maya has received all of
   * ROUND_START's broadcasts (TIMER_UPDATE is last to her), so a later listener
   * can't race a stale snapshot.
   */
  async function activeRound(bomb: BombState): Promise<{ sessionId: string }> {
    const ack = await createSession(facilitator);
    const j1 = await joinAs(maya, ack.joinCode, 'Maya');
    const mayaId = idOf(j1, 'Maya');
    const j2 = await joinAs(devon, ack.joinCode, 'Devon');
    const devonId = idOf(j2, 'Devon');

    const everyone = () =>
      Promise.all([facilitator, maya, devon].map((s) => nextEvent<SessionState>(s, 'SESSION_STATE')));
    let done = everyone();
    facilitator.emit('TEAM_ASSIGN', { playerId: mayaId, teamId: 'A', role: 'expert' });
    await done;
    done = everyone();
    facilitator.emit('TEAM_ASSIGN', { playerId: devonId, teamId: 'B', role: 'expert' });
    await done;
    done = everyone();
    facilitator.emit('PREPARATION_OPEN');
    await done;

    const mayaTimer = nextEvent(maya, 'TIMER_UPDATE');
    facilitator.emit('ROUND_START');
    await mayaTimer;

    // Replace the generated bomb with the controlled one (team-private key).
    await store.setJSON(bombKey(ack.sessionId, 'A'), bomb);
    return { sessionId: ack.sessionId };
  }

  it('correct cut → MODULE_UPDATE solved to the team room + BOMB_DEFUSED', async () => {
    const { sessionId } = await activeRound(wiresBomb(1));

    const updatePromise = nextEvent<ModuleUpdate>(maya, 'MODULE_UPDATE');
    const defusedPromise = nextEvent<{ teamId: string; elapsedMs: number }>(maya, 'BOMB_DEFUSED');
    maya.emit('MODULE_INTERACT', { teamId: 'A', moduleIndex: 0, action: { type: 'CUT', wireIndex: 1 } });

    const update = await updatePromise;
    expect(update.moduleIndex).toBe(0);
    expect(update.state.status).toBe('solved');

    const defused = await defusedPromise;
    expect(defused.teamId).toBe('A');
    expect(typeof defused.elapsedMs).toBe('number');

    const persisted = JSON.parse(store.data.get(bombKey(sessionId, 'A'))!) as BombState;
    expect(persisted.solved).toBe(true);
    expect(persisted.modules[0].status).toBe('solved');
  });

  it('wrong cut → MODULE_UPDATE armed (post struck rollup) + STRIKE, no defuse', async () => {
    await activeRound(wiresBomb(1));

    const updatePromise = nextEvent<ModuleUpdate>(maya, 'MODULE_UPDATE');
    const strikePromise = nextEvent<StrikePayload>(maya, 'STRIKE');
    const defusedSpy = jest.fn();
    maya.on('BOMB_DEFUSED', defusedSpy);
    maya.emit('MODULE_INTERACT', { teamId: 'A', moduleIndex: 0, action: { type: 'CUT', wireIndex: 0 } });

    const update = await updatePromise;
    // 'struck' is transient: the broadcast module state is the rolled-up 'armed'.
    expect(update.state.status).toBe('armed');

    const strike = await strikePromise;
    expect(strike).toMatchObject({ teamId: 'A', strikes: 1 });
    expect(strike.timer).toBeDefined();
    expect(defusedSpy).not.toHaveBeenCalled();
  });

  it('third strike → STRIKE(3) for the count, then BOMB_EXPLODED, timer key cleared', async () => {
    // Seed at 2 strikes so the next wrong cut is the terminal third.
    const { sessionId } = await activeRound(wiresBomb(1, 2));

    const updatePromise = nextEvent<ModuleUpdate>(maya, 'MODULE_UPDATE');
    const strikePromise = nextEvent<StrikePayload>(maya, 'STRIKE');
    const explodedPromise = nextEvent<{ teamId: string }>(maya, 'BOMB_EXPLODED');
    maya.emit('MODULE_INTERACT', { teamId: 'A', moduleIndex: 0, action: { type: 'CUT', wireIndex: 0 } });

    await updatePromise;
    // The terminal strike still broadcasts the count (3) so the client labels the
    // loss DETONATED (not TIME EXPIRED) and lights the 3rd strike dot. No timer
    // rebase happens (escalateOnStrike is skipped) — it carries the live timer.
    const strike = await strikePromise;
    expect(strike.strikes).toBe(3);
    const exploded = await explodedPromise;
    expect(exploded.teamId).toBe('A');
    // resolveRound deletes the team's live timer key (the per-team fence).
    expect(store.data.has(timerKey(sessionId, 'A'))).toBe(false);
  });

  it('out-of-range moduleIndex → ERROR, no broadcast', async () => {
    await activeRound(wiresBomb(1));

    const updateSpy = jest.fn();
    maya.on('MODULE_UPDATE', updateSpy);
    const errorPromise = nextEvent<ErrorPayload>(maya, 'ERROR');
    maya.emit('MODULE_INTERACT', { teamId: 'A', moduleIndex: 5, action: { type: 'CUT', wireIndex: 0 } });

    const error = await errorPromise;
    expect(error.code).toBe('INVALID_MODULE_INTERACT');
    expect(error.recoverable).toBe(true);
    await new Promise((r) => setTimeout(r, 80));
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("a socket interacting with a team it does not defuse → NOT_TEAM_DEFUSER", async () => {
    await activeRound(wiresBomb(1));

    const updateSpy = jest.fn();
    maya.on('MODULE_UPDATE', updateSpy);
    const errorPromise = nextEvent<ErrorPayload>(maya, 'ERROR');
    // Maya defuses Team A; claiming Team B is rejected.
    maya.emit('MODULE_INTERACT', { teamId: 'B', moduleIndex: 0, action: { type: 'CUT', wireIndex: 0 } });

    const error = await errorPromise;
    expect(error.code).toBe('NOT_TEAM_DEFUSER');
    await new Promise((r) => setTimeout(r, 80));
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('malformed action (not an object) → ERROR, no broadcast, no throw', async () => {
    await activeRound(wiresBomb(1));

    const updateSpy = jest.fn();
    maya.on('MODULE_UPDATE', updateSpy);
    const errorPromise = nextEvent<ErrorPayload>(maya, 'ERROR');
    maya.emit('MODULE_INTERACT', {
      teamId: 'A',
      moduleIndex: 0,
      action: 'CUT',
    } as never);

    const error = await errorPromise;
    expect(error.code).toBe('INVALID_MODULE_INTERACT');
    await new Promise((r) => setTimeout(r, 80));
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('a malformed-but-shaped action the reducer rejects is a silent no-op (no broadcast, no error)', async () => {
    await activeRound(wiresBomb(1));

    const updateSpy = jest.fn();
    const errorSpy = jest.fn();
    maya.on('MODULE_UPDATE', updateSpy);
    maya.on('ERROR', errorSpy);
    // Object action with an out-of-range wireIndex: the wires reducer no-ops
    // (returns same state) → bombReducer returns same ref → handler emits nothing.
    maya.emit('MODULE_INTERACT', {
      teamId: 'A',
      moduleIndex: 0,
      action: { type: 'CUT', wireIndex: 99 },
    });

    await new Promise((r) => setTimeout(r, 120));
    expect(updateSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('interacting with an already-solved module is an inert no-op (no second MODULE_UPDATE)', async () => {
    await activeRound(wiresBomb(1));

    // First cut solves it.
    const firstUpdate = nextEvent<ModuleUpdate>(maya, 'MODULE_UPDATE');
    maya.emit('MODULE_INTERACT', { teamId: 'A', moduleIndex: 0, action: { type: 'CUT', wireIndex: 1 } });
    await firstUpdate;

    // A second interaction on the solved module is inert (solved-inert guard).
    const updateSpy = jest.fn();
    const errorSpy = jest.fn();
    maya.on('MODULE_UPDATE', updateSpy);
    maya.on('ERROR', errorSpy);
    maya.emit('MODULE_INTERACT', { teamId: 'A', moduleIndex: 0, action: { type: 'CUT', wireIndex: 0 } });

    await new Promise((r) => setTimeout(r, 120));
    expect(updateSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('a never-joined socket → NOT_IN_SESSION', async () => {
    const outsider = await server.connectClient();
    const errorPromise = nextEvent<ErrorPayload>(outsider, 'ERROR');
    outsider.emit('MODULE_INTERACT', { teamId: 'A', moduleIndex: 0, action: { type: 'CUT', wireIndex: 0 } });
    const error = await errorPromise;
    expect(error.code).toBe('NOT_IN_SESSION');
  });
});
