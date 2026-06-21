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

// 'manual' = idle on BOMB_INIT; the dev drives the bot by hand from the control
// panel (solveNow / detonateNow). The other three auto-drive on each BOMB_INIT.
export type Outcome = 'defuse' | 'strike' | 'timeout' | 'manual';
export type BotSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A timestamped line in a bot's recent-event ring buffer (panel event log). */
export interface BotLogEntry {
  t: number;
  msg: string;
}

export interface BotClientOptions {
  url: string;
  displayName: string;
  /** What the Defuser should do each round. Default 'defuse'. */
  outcome?: Outcome;
  /** ms between successive MODULE_INTERACT emits — keeps a run watchable. */
  pacingMs?: number;
  log?: (msg: string) => void;
  /**
   * Fired whenever this bot's observable state changes (any server event,
   * connect/disconnect, or a local action). The control panel passes a single
   * re-render callback so its dashboard tracks every bot live. No-arg by design:
   * the panel re-reads the swarm rather than diffing a payload.
   */
  onUpdate?: () => void;
}

export class BotClient {
  readonly displayName: string;
  /** Durable session id — captured from SESSION_IDENTITY, used as reconnect auth. */
  sessionId: string | null = null;
  playerId: string | null = null;
  reattachToken: string | null = null;
  session: SessionState | null = null;
  bomb: BombState | null = null;
  timer: TimerState | null = null;
  resolved: 'defused' | 'exploded' | null = null;
  /** Latest authoritative strike total for this bot's team (from STRIKE). */
  strikes = 0;
  /**
   * The round number that this bot's current `strikes`/`resolved` belong to. Lets
   * the panel show those per-round (hide them once a newer round is underway)
   * while the fields themselves persist for the headless verify harness. Null
   * until this bot has played a round.
   */
  roundTag: number | null = null;
  /** Live socket connection state (drives the panel's Conn column). */
  connected = false;
  /** Last typed ERROR surfaced by the server, for the panel's status column. */
  lastError: string | null = null;
  /** Recent events (capped) for the panel's per-bot log. Newest last. */
  readonly recent: BotLogEntry[] = [];

  outcome: Outcome;
  /** Re-render hook for the control panel; settable post-construction by the swarm. */
  onUpdate?: () => void;
  private readonly url: string;
  private readonly pacingMs: number;
  private readonly log: (msg: string) => void;
  private socket: BotSocket | null = null;
  /** Guards the reactive solve so a single BOMB_INIT triggers one run. */
  private solvingRound = -1;
  /** True while a manual solveNow/detonateNow drive is in flight (panel guard). */
  driving = false;

  constructor(opts: BotClientOptions) {
    this.displayName = opts.displayName;
    this.url = opts.url;
    this.outcome = opts.outcome ?? 'defuse';
    this.pacingMs = opts.pacingMs ?? 150;
    this.log = opts.log ?? (() => {});
    this.onUpdate = opts.onUpdate;
  }

  /** Append to the recent-event ring buffer and notify the panel. */
  private note(msg: string): void {
    this.recent.push({ t: Date.now(), msg });
    if (this.recent.length > 30) this.recent.shift();
    this.touch();
  }

  /** Fire the panel re-render hook; never let a render error break the bot. */
  private touch(): void {
    try {
      this.onUpdate?.();
    } catch {
      /* a panel render fault must not crash the bot */
    }
  }

  get sock(): BotSocket {
    if (this.socket === null) throw new Error(`${this.displayName}: not connected`);
    return this.socket;
  }

  /**
   * Open a fresh socket. When `restore` is set and we already hold a durable
   * identity, the reconnect handshake presents `{ sessionId, reattachToken }`
   * via `auth` so the server re-materialises THIS seat (Story 2.7 reattach)
   * instead of minting a new player — this is what makes "simulate disconnect"
   * a faithful drop/rejoin rather than a brand-new join.
   */
  async connect(restore = false): Promise<void> {
    const auth =
      restore && this.sessionId !== null && this.reattachToken !== null
        ? { sessionId: this.sessionId, reattachToken: this.reattachToken }
        : undefined;
    const socket: BotSocket = io(this.url, {
      transports: ['websocket'],
      forceNew: true,
      ...(auth ? { auth } : {}),
    });
    this.socket = socket;
    this.wire(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', (err) => reject(err));
    });
  }

  /** Drop the socket then re-handshake with the reattach token (restore the seat). */
  async reconnect(): Promise<void> {
    this.socket?.disconnect();
    await this.connect(true);
    this.note('reconnected (reattach)');
  }

  private wire(socket: BotSocket): void {
    socket.on('connect', () => {
      this.connected = true;
      this.touch();
    });
    socket.on('disconnect', (reason) => {
      this.connected = false;
      this.note(`disconnected (${reason})`);
    });
    socket.on('SESSION_IDENTITY', (p) => {
      this.sessionId = p.sessionId;
      this.playerId = p.playerId;
      this.reattachToken = p.reattachToken;
      this.touch();
    });
    socket.on('SESSION_STATE', (s) => {
      this.session = s;
      this.touch();
    });
    socket.on('BOMB_INIT', (b) => {
      this.bomb = b;
      // Fresh round: reset round-scoped state. strikes MUST reset or detonateNow's
      // `while (strikes < 3)` guard stays false after the first detonation and no
      // further round can be struck/detonated. roundTag stamps this bot's state to
      // the round it belongs to so the panel can show it per-round (the fields
      // themselves persist across rounds for the headless verify harness, which
      // reads `resolved` as each player's once-only relay outcome).
      this.resolved = null;
      this.strikes = 0;
      this.roundTag = this.session?.roundNumber ?? null;
      // NB: do NOT clear `this.timer` here — TIMER_UPDATE can arrive before
      // BOMB_INIT and isn't re-sent on a periodic tick, so wiping it would strip
      // the timer the button's hold-release polls. The panel hides a stale timer
      // via its `status === 'active'` gate instead.
      this.note(`BOMB_INIT round ${this.session?.roundNumber ?? '?'}`);
      void this.onBombInit();
    });
    socket.on('MODULE_UPDATE', (u) => {
      if (this.bomb && u.moduleIndex >= 0 && u.moduleIndex < this.bomb.modules.length) {
        this.bomb.modules[u.moduleIndex] = u.state;
      }
      this.touch();
    });
    socket.on('TIMER_UPDATE', (t) => {
      this.timer = t;
      // No touch(): TIMER_UPDATE is high-frequency; the panel reads timer lazily.
    });
    socket.on('STRIKE', (p) => {
      this.strikes = p.strikes;
      this.roundTag = this.session?.roundNumber ?? this.roundTag;
      this.note(`STRIKE → ${p.strikes}`);
    });
    socket.on('PAUSED', (p) => this.note(`PAUSED: ${p.reason}`));
    socket.on('RESUMED', (p) => this.note(`RESUMED: ${p.reason}`));
    socket.on('BOMB_DEFUSED', () => {
      this.resolved = 'defused';
      this.roundTag = this.session?.roundNumber ?? this.roundTag;
      this.note('BOMB_DEFUSED');
    });
    socket.on('BOMB_EXPLODED', () => {
      this.resolved = 'exploded';
      this.roundTag = this.session?.roundNumber ?? this.roundTag;
      this.note('BOMB_EXPLODED');
    });
    socket.on('ERROR', (e) => {
      this.lastError = `${e.code}: ${e.message}`;
      this.log(`[${this.displayName}] ERROR ${e.code}: ${e.message}`);
      this.note(`ERROR ${e.code}`);
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

  /** Facilitator-only. Returns Preparation to the lobby for the same round. */
  preparationCancel(): void {
    this.sock.emit('PREPARATION_CANCEL');
  }

  /** Facilitator-only. */
  startRound(): void {
    this.sock.emit('ROUND_START');
  }

  /** Facilitator-only. Freeze the active round / between-rounds phase (Story 8.7). */
  pause(): void {
    this.sock.emit('FACILITATOR_PAUSE');
  }

  /** Facilitator-only. Lift a pause (a disconnect pause also needs all players ready). */
  resume(): void {
    this.sock.emit('FACILITATOR_RESUME');
  }

  disconnect(): void {
    this.socket?.disconnect();
  }

  // ─── Status getters (read by the control panel) ──────────────────────────────

  /** This bot's assigned team, or undefined if unassigned / not yet in a session. */
  get team(): TeamId | undefined {
    return this.myTeam();
  }

  /** This bot's role from the authoritative roster (facilitator/defuser/expert/spectator). */
  get role(): PlayerRole | undefined {
    return this.playerId ? this.session?.players[this.playerId]?.role : undefined;
  }

  /** This bot's own ready flag from the roster. */
  get isReady(): boolean {
    return this.playerId !== null && (this.session?.players[this.playerId]?.isReady ?? false);
  }

  /** True when this bot is the Defuser of the currently-active round (can interact). */
  get isCurrentDefuser(): boolean {
    return this.isDefuser() && this.session?.status === 'active';
  }

  /** True when an on-demand solve/detonate is sensible right now. */
  get canDrive(): boolean {
    return (
      this.isCurrentDefuser &&
      this.bomb !== null &&
      this.resolved === null &&
      this.session?.pausedAt == null &&
      !this.driving
    );
  }

  // ─── On-demand drives (manual mode — triggered from the panel) ────────────────

  /** Solve the whole bomb now (only valid if this bot is the active Defuser). */
  async solveNow(): Promise<void> {
    const teamId = this.myTeam();
    if (!this.canDrive || teamId === undefined) return;
    this.driving = true;
    this.touch();
    try {
      await this.driveDefuse(teamId);
    } catch (err) {
      this.log(`[${this.displayName}] solveNow aborted: ${(err as Error).message}`);
    } finally {
      this.driving = false;
      this.touch();
    }
  }

  /**
   * Strike repeatedly until the bomb explodes (strikes ≥ 3) or resolves. Skips
   * modules that only strike once (a wrong wire cut can't repeat) by marking them
   * exhausted after a no-op attempt, so an all-wires bomb still reaches 3 strikes
   * across its modules. Guarded so a stuck bomb can't loop forever.
   */
  async detonateNow(): Promise<void> {
    const teamId = this.myTeam();
    if (!this.canDrive || teamId === undefined || this.bomb === null) return;
    this.driving = true;
    this.touch();
    const exhausted = new Set<number>();
    try {
      for (let guard = 0; this.strikes < 3 && this.resolved === null && guard < 24; guard++) {
        const before = this.strikes;
        const target = this.nextStrikeTarget(exhausted);
        if (target === null) {
          this.log(`[${this.displayName}] no strikeable module remains (strikes=${this.strikes})`);
          break;
        }
        await this.emitStrike(teamId, target.index, target.plan);
        await this.waitUntil(() => this.strikes > before || this.resolved !== null, 5000).catch(() => {});
        if (this.strikes === before) exhausted.add(target.index); // that module won't strike again
      }
    } catch (err) {
      this.log(`[${this.displayName}] detonateNow aborted: ${(err as Error).message}`);
    } finally {
      this.driving = false;
      this.touch();
    }
  }

  /** Emit a single deliberately-wrong action (one strike), for fine-grained testing. */
  async strikeOnce(): Promise<void> {
    const teamId = this.myTeam();
    if (!this.canDrive || teamId === undefined) return;
    this.driving = true;
    this.touch();
    try {
      await this.driveStrike(teamId);
    } catch (err) {
      this.log(`[${this.displayName}] strikeOnce aborted: ${(err as Error).message}`);
    } finally {
      this.driving = false;
      this.touch();
    }
  }

  /** First non-solved, non-exhausted module with a one-shot strike plan, or null. */
  private nextStrikeTarget(exhausted: Set<number>): { index: number; plan: NonNullable<ReturnType<typeof strikeModule>> } | null {
    const modules = this.bomb!.modules;
    for (let i = 0; i < modules.length; i++) {
      if (exhausted.has(i) || modules[i].status === 'solved') continue;
      const plan = strikeModule(modules[i]);
      if (plan !== null) return { index: i, plan };
    }
    return null;
  }

  /** Emit each step of a strike plan against one module. */
  private async emitStrike(teamId: TeamId, index: number, plan: NonNullable<ReturnType<typeof strikeModule>>): Promise<void> {
    for (const step of plan) {
      if (step.kind === 'emit') this.sock.emit('MODULE_INTERACT', { teamId, moduleIndex: index, action: step.action });
      await sleep(this.pacingMs);
    }
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
      if (this.outcome === 'manual') return; // idle: the dev drives via the panel
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
