/**
 * BotClient — one simulated player. A thin wrapper over a TYPED socket.io-client
 * connection (`Socket<ServerToClientEvents, ClientToServerEvents>`), so every
 * emit is compile-checked against the real contract — `socket.emit(string, any)`
 * is impossible here too (project-context: typed events only).
 *
 * Server-truth-driven: the bot holds NO game logic of its own beyond CHOOSING a
 * move via the shared solvers. It mirrors SESSION_STATE / BOMB_INIT / MODULE_UPDATE
 * / TIMER_UPDATE from the broadcast and lets the server adjudicate — it never
 * runs the timer or invents state (project-context: server-authoritative).
 *
 * Authority is respected: only the player the server made the current Defuser
 * (role 'defuser' after startRound) acts on the bomb; a non-defuser's interact
 * would just earn a typed ERROR, which the bot surfaces rather than crashing.
 */
import { io, type Socket } from 'socket.io-client';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  SessionState,
  BombState,
  TimerState,
  TeamId,
  PlayerRole,
  RoundConfig,
} from '@bomb-squad/shared';
import { solveModule, strikeModule } from './solvers.js';
import { displayedTimerDigits } from './timerDigits.js';

export type Outcome = 'defuse' | 'strike' | 'timeout';
export type BotSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface BotClientOptions {
  url: string;
  displayName: string;
  /** What the Defuser should do each round. Default 'defuse'. */
  outcome?: Outcome;
  /** ms between successive MODULE_INTERACT emits — keeps a run watchable. */
  pacingMs?: number;
  log?: (msg: string) => void;
}

export class BotClient {
  readonly displayName: string;
  playerId: string | null = null;
  reattachToken: string | null = null;
  session: SessionState | null = null;
  bomb: BombState | null = null;
  timer: TimerState | null = null;
  resolved: 'defused' | 'exploded' | null = null;
  /** Latest authoritative strike total for this bot's team (from STRIKE). */
  strikes = 0;

  outcome: Outcome;
  private readonly url: string;
  private readonly pacingMs: number;
  private readonly log: (msg: string) => void;
  private socket: BotSocket | null = null;
  /** Guards the reactive solve so a single BOMB_INIT triggers one run. */
  private solvingRound = -1;

  constructor(opts: BotClientOptions) {
    this.displayName = opts.displayName;
    this.url = opts.url;
    this.outcome = opts.outcome ?? 'defuse';
    this.pacingMs = opts.pacingMs ?? 150;
    this.log = opts.log ?? (() => {});
  }

  get sock(): BotSocket {
    if (this.socket === null) throw new Error(`${this.displayName}: not connected`);
    return this.socket;
  }

  async connect(): Promise<void> {
    const socket: BotSocket = io(this.url, { transports: ['websocket'], forceNew: true });
    this.socket = socket;
    this.wire(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', (err) => reject(err));
    });
  }

  private wire(socket: BotSocket): void {
    socket.on('SESSION_IDENTITY', (p) => {
      this.playerId = p.playerId;
      this.reattachToken = p.reattachToken;
    });
    socket.on('SESSION_STATE', (s) => {
      this.session = s;
    });
    socket.on('BOMB_INIT', (b) => {
      this.bomb = b;
      this.resolved = null;
      void this.onBombInit();
    });
    socket.on('MODULE_UPDATE', (u) => {
      if (this.bomb && u.moduleIndex >= 0 && u.moduleIndex < this.bomb.modules.length) {
        this.bomb.modules[u.moduleIndex] = u.state;
      }
    });
    socket.on('TIMER_UPDATE', (t) => {
      this.timer = t;
    });
    socket.on('STRIKE', (p) => {
      this.strikes = p.strikes;
    });
    socket.on('BOMB_DEFUSED', () => {
      this.resolved = 'defused';
    });
    socket.on('BOMB_EXPLODED', () => {
      this.resolved = 'exploded';
    });
    socket.on('ERROR', (e) => {
      this.log(`[${this.displayName}] ERROR ${e.code}: ${e.message}`);
    });
  }

  // ─── Lobby actions ─────────────────────────────────────────────────────────

  /** Facilitator-only: create the session. Resolves with the join code. */
  async createSession(config?: Partial<RoundConfig>): Promise<{ sessionId: string; joinCode: string }> {
    const ack = await new Promise<{ sessionId: string; joinCode: string }>((resolve) =>
      this.sock.emit('SESSION_CREATE', { config }, (r) => resolve(r)),
    );
    await this.waitUntil(() => this.playerId !== null);
    return ack;
  }

  /** Join an existing session as a player; resolves once the durable id lands. */
  async join(joinCode: string, role: PlayerRole = 'defuser'): Promise<void> {
    this.sock.emit('SESSION_JOIN', { joinCode, displayName: this.displayName, role });
    await this.waitUntil(() => this.playerId !== null);
  }

  ready(isReady = true): void {
    this.sock.emit('PLAYER_READY', { isReady });
  }

  /** Facilitator-only: assign a player to a team + role. */
  assignTeam(playerId: string, teamId: TeamId, role: PlayerRole): void {
    this.sock.emit('TEAM_ASSIGN', { playerId, teamId, role });
  }

  /** Facilitator-only. */
  configureRound(config: RoundConfig): void {
    this.sock.emit('ROUND_CONFIGURE', { config });
  }

  /** Facilitator-only. */
  openPreparation(): void {
    this.sock.emit('PREPARATION_OPEN');
  }

  /** Facilitator-only. */
  startRound(): void {
    this.sock.emit('ROUND_START');
  }

  disconnect(): void {
    this.socket?.disconnect();
  }

  // ─── Reactive defuser loop ───────────────────────────────────────────────────

  private myTeam(): TeamId | undefined {
    return this.playerId ? this.session?.players[this.playerId]?.teamId : undefined;
  }

  private isDefuser(): boolean {
    return !!this.playerId && this.session?.players[this.playerId]?.role === 'defuser';
  }

  /** Fired on BOMB_INIT: if this bot is its team's Defuser, drive the outcome. */
  private async onBombInit(): Promise<void> {
    const round = this.session?.roundNumber ?? 0;
    if (!this.isDefuser()) return; // only the Defuser may interact (server authority)
    if (this.solvingRound === round) return; // one run per round
    this.solvingRound = round;
    const teamId = this.myTeam();
    if (teamId === undefined || this.bomb === null) return;

    this.log(`[${this.displayName}] Defuser for team ${teamId}, round ${round} → ${this.outcome}`);
    try {
      if (this.outcome === 'timeout') return; // idle: let the server clock expire
      if (this.outcome === 'strike') return void (await this.driveStrike(teamId));
      await this.driveDefuse(teamId);
    } catch (err) {
      this.log(`[${this.displayName}] solve aborted: ${(err as Error).message}`);
    }
  }

  /** Emit ONE deliberately-wrong action on the first strikeable module. */
  private async driveStrike(teamId: TeamId): Promise<void> {
    const modules = this.bomb!.modules;
    for (let i = 0; i < modules.length; i++) {
      const plan = strikeModule(modules[i]);
      if (plan === null) continue;
      for (const step of plan) {
        if (step.kind === 'emit') this.sock.emit('MODULE_INTERACT', { teamId, moduleIndex: i, action: step.action });
        await sleep(this.pacingMs);
      }
      return;
    }
    this.log(`[${this.displayName}] no strikeable module found`);
  }

  /** Solve every module in order until the bomb is defused. */
  private async driveDefuse(teamId: TeamId): Promise<void> {
    const count = this.bomb!.modules.length;
    for (let i = 0; i < count; i++) {
      if (this.resolved !== null) return;
      if (this.bomb!.modules[i].status === 'solved') continue;
      const plan = solveModule(this.bomb!.modules[i]);
      if (plan === null) {
        this.log(`[${this.displayName}] cannot solve module ${i} (${this.bomb!.modules[i].moduleId})`);
        continue;
      }
      for (const step of plan) {
        if (step.kind === 'emit') {
          this.sock.emit('MODULE_INTERACT', { teamId, moduleIndex: i, action: step.action });
        } else {
          // Button HOLD: release once the displayed timer shows the digit.
          const digits = await this.waitForTimerDigit(step.digit);
          this.sock.emit('MODULE_INTERACT', { teamId, moduleIndex: i, action: { type: 'RELEASE', timerDigits: digits } });
        }
        await sleep(this.pacingMs);
      }
      // Confirm the module solved before moving on (a wrong cut would re-arm).
      await this.waitUntil(() => this.resolved !== null || this.bomb!.modules[i].status === 'solved', 8000).catch(() => {
        this.log(`[${this.displayName}] module ${i} not confirmed solved`);
      });
    }
  }

  /** Poll the live timer until its displayed digits include `digit`; returns them. */
  private async waitForTimerDigit(digit: number, timeoutMs = 30_000): Promise<number[]> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (this.timer) {
        const digits = displayedTimerDigits(this.timer, Date.now());
        if (digits.includes(digit)) return digits;
      }
      if (Date.now() > deadline) return this.timer ? displayedTimerDigits(this.timer, Date.now()) : [];
      await sleep(200);
    }
  }

  /** Resolve when `pred()` is true, or reject after `timeoutMs`. */
  async waitUntil(pred: () => boolean, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!pred()) {
      if (Date.now() > deadline) throw new Error('waitUntil timed out');
      await sleep(25);
    }
  }
}
