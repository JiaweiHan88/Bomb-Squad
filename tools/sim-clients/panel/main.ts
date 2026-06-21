/**
 * Bot Control Panel — a single dev page that runs the whole bot swarm IN THE
 * BROWSER and renders one dashboard for every bot. Replaces juggling terminal
 * flags + four browser windows: spawn bots, watch their roles/strikes live, and
 * drive each one by hand (ready, disconnect/reconnect, solve, detonate).
 *
 * The bots are the SAME BotClient the CLI uses (socket.io-client + the
 * framework-free @bomb-squad/shared solvers — both browser-safe). The panel owns
 * NO game logic; it only spawns bots, reads their mirrored state, and calls their
 * methods. Server-authoritative throughout.
 */
import {
  buildJoinSwarm,
  buildAutonomousSwarm,
  teardown,
  type Swarm,
  type SwarmOptions,
} from '../src/swarm.js';
import type { BotClient, Outcome } from '../src/BotClient.js';
import { timerRemainingMs, formatTimerDisplay } from '../src/timerDigits.js';
import { WIRES_MODULE_ID, BUTTON_MODULE_ID, PASSWORDS_MODULE_ID } from '@bomb-squad/shared';
import type {
  SessionState,
  ModuleState,
  WiresState,
  ButtonState,
  PasswordsState,
} from '@bomb-squad/shared';

const app = document.getElementById('app') as HTMLElement;
const connSummary = document.getElementById('conn-summary') as HTMLElement;

let swarm: Swarm | null = null;
let spawning = false;
const logLines: string[] = [];

// ─── Logging ───────────────────────────────────────────────────────────────

function pushLog(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  logLines.push(`<span class="t">${ts}</span> ${escapeHtml(msg)}`);
  if (logLines.length > 400) logLines.shift();
  scheduleRender();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

// ─── Render scheduling (coalesce bursts of bot updates into one paint) ────────

let renderQueued = false;
function scheduleRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

// ─── Spawn ───────────────────────────────────────────────────────────────────

interface SpawnForm {
  url: string;
  mode: 'join' | 'create';
  code: string;
  teams: number;
  perTeam: number;
  sizes: string;
  modules: number;
  outcome: Outcome;
}

function readForm(): SpawnForm {
  const v = (id: string): string => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement)?.value ?? '';
  return {
    url: v('f-url').trim() || 'http://localhost',
    mode: v('f-mode') as 'join' | 'create',
    code: v('f-code').trim().toUpperCase(),
    teams: Number(v('f-teams')) || 2,
    perTeam: Number(v('f-perteam')) || 2,
    sizes: v('f-sizes').trim(),
    modules: Number(v('f-modules')) || 0,
    outcome: (v('f-outcome') as Outcome) || 'manual',
  };
}

async function spawn(): Promise<void> {
  if (swarm || spawning) return;
  const form = readForm();
  if (form.mode === 'join' && !form.code) {
    pushLog('⚠ enter a join code (or switch to Create mode)');
    return;
  }
  spawning = true;
  scheduleRender();

  const sizes = form.sizes
    ? form.sizes.split(',').map((n) => Number(n.trim())).filter((n) => Number.isFinite(n) && n > 0)
    : undefined;

  const opts: SwarmOptions = {
    url: form.url,
    teams: form.teams,
    perTeam: form.perTeam,
    ...(sizes && sizes.length ? { sizes } : {}),
    outcome: form.outcome,
    // Snappier than the CLI's 150ms default — the panel is interactive, not a
    // "watchable" demo, so tighten the inter-emit pacing for faster solve/strike.
    pacingMs: 70,
    log: (m) => pushLog(m),
    onUpdate: () => scheduleRender(),
  };

  try {
    if (form.mode === 'create') {
      const config = form.modules > 0 ? { moduleCount: form.modules } : undefined;
      const s = await buildAutonomousSwarm(opts, config);
      swarm = s;
      pushLog(`✅ session created — join code ${s.joinCode} (open it in a browser to be Facilitator's audience, or drive from here)`);
    } else {
      swarm = await buildJoinSwarm(opts, form.code);
      pushLog(`✅ ${swarm.players.length} bots joined ${form.code} — drive the round from your Facilitator browser, or watch here`);
    }
  } catch (err) {
    pushLog(`❌ spawn failed: ${(err as Error).message}`);
  } finally {
    spawning = false;
    scheduleRender();
  }
}

function tearDownSwarm(): void {
  if (!swarm) return;
  teardown(swarm);
  pushLog('🧹 swarm torn down');
  swarm = null;
  scheduleRender();
}

// ─── Action dispatch (event delegation) ──────────────────────────────────────

function bot(idx: number): BotClient | undefined {
  return swarm?.all[idx];
}

function defusers(): BotClient[] {
  return (swarm?.all ?? []).filter((b) => b.canDrive);
}

async function dispatch(action: string, idx: number): Promise<void> {
  const fac = swarm?.facilitator ?? undefined;
  const b = idx >= 0 ? bot(idx) : undefined;
  switch (action) {
    // Spawn / lifecycle
    case 'spawn': return void spawn();
    case 'teardown': return tearDownSwarm();

    // Facilitator round lifecycle
    case 'fac-openprep': return fac?.openPreparation();
    case 'fac-cancelprep': return fac?.preparationCancel();
    case 'fac-start': return fac?.startRound();
    case 'fac-pause': return fac?.pause();
    case 'fac-resume': return fac?.resume();

    // Bulk
    case 'all-ready': return void swarm?.players.forEach((p) => p.ready(true));
    case 'all-unready': return void swarm?.players.forEach((p) => p.ready(false));
    case 'ready-gate': // ready up every connected player to satisfy a disconnect-resume gate
      return void swarm?.players.filter((p) => p.connected).forEach((p) => p.ready(true));
    case 'reconnect-all':
      return void (await Promise.all((swarm?.all ?? []).filter((p) => !p.connected).map((p) => p.reconnect())));
    case 'solve-all': return void (await Promise.all(defusers().map((d) => d.solveNow())));
    case 'detonate-all': return void (await Promise.all(defusers().map((d) => d.detonateNow())));

    // Per-bot
    case 'ready-toggle': return b?.ready(!b.isReady);
    case 'disconnect': b?.disconnect(); return;
    case 'reconnect': return void (await b?.reconnect());
    case 'solve': return void (await b?.solveNow());
    case 'detonate': return void (await b?.detonateNow());
    case 'strike': return void (await b?.strikeOnce());
  }
}

app.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
  if (!el) return;
  void dispatch(el.dataset.action!, Number(el.dataset.bot ?? -1));
});

app.addEventListener('change', (e) => {
  const el = e.target as HTMLElement;
  if (el.dataset.outcome !== undefined) {
    const b = bot(Number(el.dataset.bot));
    if (b) {
      b.outcome = (el as HTMLSelectElement).value as Outcome;
      pushLog(`${b.displayName}: auto-mode → ${b.outcome}`);
    }
  }
});

// ─── Render ──────────────────────────────────────────────────────────────────

function render(): void {
  if (swarm) {
    // Dashboard has no free-text inputs — safe to fully re-render each tick.
    app.innerHTML = renderDashboard(swarm);
  } else if (!document.getElementById('f-url')) {
    // Build the spawn form once; rebuilding it on every log tick would wipe
    // whatever the user is typing (e.g. the join code).
    app.innerHTML = renderSpawnForm();
  } else {
    // Spawn form already mounted: only reflect the spawning state on its button.
    const btn = app.querySelector('[data-action="spawn"]') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = spawning;
      btn.textContent = spawning ? 'Spawning…' : '▶ Spawn swarm';
    }
  }
  renderLogInto();
  updateConnSummary();
}

function updateConnSummary(): void {
  if (!swarm) {
    connSummary.textContent = '';
    return;
  }
  const total = swarm.all.length;
  const up = swarm.all.filter((b) => b.connected).length;
  const s = swarm.players[0]?.session;
  connSummary.textContent = `${up}/${total} sockets up${s ? ` · session ${s.status}` : ''}`;
}

function renderSpawnForm(): string {
  return `
  <div class="card">
    <h2>Spawn a bot swarm</h2>
    <div class="row">
      <span><label>Server</label><input class="url" id="f-url" value="http://localhost" /></span>
      <div class="sep"></div>
      <span><label>Mode</label>
        <select id="f-mode" onchange="this.dispatchEvent(new Event('mode-change',{bubbles:true}))">
          <option value="join">Join (human is Facilitator)</option>
          <option value="create">Create (a bot is Facilitator)</option>
        </select>
      </span>
      <span><label>Join code</label><input class="code" id="f-code" placeholder="ABC123" /></span>
    </div>
    <div class="row">
      <span><label>Teams</label><input id="f-teams" type="number" min="1" max="2" value="2" /></span>
      <span><label>Per team</label><input id="f-perteam" type="number" min="2" value="2" /></span>
      <span><label>Sizes</label><input id="f-sizes" placeholder="e.g. 3,2" /></span>
      <span><label>Modules</label><input id="f-modules" type="number" min="0" max="11" value="0" placeholder="default" /></span>
      <span><label>Auto-mode</label>
        <select id="f-outcome">
          <option value="manual" selected>manual (you drive)</option>
          <option value="defuse">defuse</option>
          <option value="strike">strike</option>
          <option value="timeout">timeout</option>
        </select>
      </span>
    </div>
    <div class="row" style="margin-top:12px">
      <button class="primary" data-action="spawn" ${spawning ? 'disabled' : ''}>${spawning ? 'Spawning…' : '▶ Spawn swarm'}</button>
    </div>
    <p class="hint">Join mode: host a session in a real browser as Facilitator, paste its code here, spawn. Sizes overrides Teams×Per-team (smallest valid odd case: 3,2). Min team size is 2.</p>
    <p class="hint"><b>Modules</b> = how many puzzle modules the bomb has (3–11). Only used in <b>Create</b> mode (where a bot configures the round); leave 0 for the difficulty-tier default. In <b>Join</b> mode it's ignored — your Facilitator browser sets the round config.</p>
  </div>
  ${renderLogCard()}`;
}

function renderDashboard(s: Swarm): string {
  const session = s.players[0]?.session ?? s.facilitator?.session ?? null;
  const fac = s.facilitator;
  return `
  ${renderBanner(session)}
  ${renderBomb(s, session)}
  <div class="card">
    <h2>Controls</h2>
    <div class="row">
      ${fac ? `
        <button data-action="fac-openprep">Open Prep</button>
        <button data-action="fac-cancelprep">Cancel Prep</button>
        <button class="primary" data-action="fac-start">Start Round</button>
        <button class="warn" data-action="fac-pause">Pause</button>
        <button class="warn" data-action="fac-resume">Resume</button>
        <div class="sep"></div>` : `<span class="pill dim">Facilitator: human (in a browser)</span><div class="sep"></div>`}
      <button data-action="all-ready">All Ready</button>
      <button data-action="all-unready">All Unready</button>
      <button data-action="ready-gate" title="Ready up every connected player — satisfies a disconnect-pause resume gate">Ready (resume-gate)</button>
      <div class="sep"></div>
      <button data-action="solve-all">Solve all Defusers</button>
      <button class="bad" data-action="detonate-all">Detonate active</button>
      <div class="sep"></div>
      <button data-action="reconnect-all">Reconnect all</button>
      <button class="bad" data-action="teardown">Teardown</button>
    </div>
  </div>
  <div class="card">
    <h2>Bots (${s.all.length})</h2>
    ${renderBotTable(s)}
  </div>
  ${renderLogCard()}`;
}

function renderBanner(session: SessionState | null): string {
  if (!session) return `<div class="card"><div class="banner"><span class="k">waiting for SESSION_STATE…</span></div></div>`;
  const paused =
    session.pausedAt != null
      ? `<span class="paused">⏸ PAUSED (${session.pauseKind})${session.disconnectedPlayerIds.length ? ` — dropped: ${session.disconnectedPlayerIds.length}` : ''}</span>`
      : `<span class="pill ok">running</span>`;
  return `
  <div class="card">
    <div class="banner">
      <span><span class="k">code</span> <b>${session.joinCode}</b></span>
      <span><span class="k">status</span> <b>${session.status}</b></span>
      <span><span class="k">round</span> <b>${session.roundNumber}</b></span>
      ${session.activeTeamId ? `<span><span class="k">active team</span> <b>${session.activeTeamId}</b></span>` : ''}
      <span><span class="k">timer</span> <b id="bomb-timer" class="timer">—</b></span>
      ${paused}
    </div>
  </div>`;
}

function renderBomb(s: Swarm, session: SessionState | null): string {
  // The active Defuser mirrors its team's (private) bomb. Fall back to any bot on
  // the active team that holds a bomb, so the card still shows between drives.
  const holder =
    s.all.find((b) => b.isCurrentDefuser && b.bomb) ??
    s.all.find((b) => b.bomb != null && session?.activeTeamId != null && b.team === session.activeTeamId);
  const bomb = holder?.bomb;
  if (!holder || !bomb) return '';
  const ctx = bomb.context;
  const solvedCount = bomb.modules.filter((m) => m.status === 'solved').length;
  const indicators = ctx.indicators.length
    ? ctx.indicators
        .map((i) => `<span class="pill ${i.lit ? 'warn' : 'dim'}">${i.label}${i.lit ? ' •lit' : ''}</span>`)
        .join(' ')
    : '<span class="dim">none</span>';
  const ports = ctx.ports.length
    ? ctx.ports.map((p) => `<span class="pill dim">${p}</span>`).join(' ')
    : '<span class="dim">none</span>';
  const rows = bomb.modules
    .map((m, i) => {
      const st = m.status === 'solved' ? 'ok' : m.status === 'struck' ? 'bad' : 'warn';
      return `<tr><td>${i}</td><td><b>${escapeHtml(m.moduleId)}</b></td><td><span class="pill ${st}">${m.status}</span></td><td class="dim">${escapeHtml(moduleDetail(m))}</td></tr>`;
    })
    .join('');
  return `
  <div class="card">
    <h2>Bomb — team ${holder.team ?? '?'} · Defuser ${escapeHtml(holder.displayName)}</h2>
    <div class="banner">
      <span><span class="k">serial</span> <b>${escapeHtml(ctx.serialNumber)}</b></span>
      <span><span class="k">batteries</span> <b>${ctx.batteryCount}</b></span>
      <span><span class="k">strikes</span> <b>${holder.strikes}/3</b></span>
      <span><span class="k">solved</span> <b>${solvedCount}/${bomb.modules.length}</b></span>
    </div>
    <div class="row" style="margin-top:8px"><span class="k">indicators</span> ${indicators}</div>
    <div class="row"><span class="k">ports</span> ${ports}</div>
    <div class="row"><span class="k">seed</span> <span class="dim">deterministic from session ${escapeHtml(session?.joinCode ?? '?')} · round ${session?.roundNumber ?? '?'} · team ${holder.team ?? '?'} (serial ${escapeHtml(ctx.serialNumber)})</span></div>
    <table style="margin-top:10px">
      <thead><tr><th>#</th><th>Module</th><th>Status</th><th>Detail</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/** Compact per-module summary for the bomb card (best-effort, known modules only). */
function moduleDetail(m: ModuleState<unknown>): string {
  if (m.moduleId === WIRES_MODULE_ID) {
    const d = m.data as WiresState;
    // cut wires shown struck-through-ish with ~…~
    return d.wires.map((w) => (w.cut ? `~${w.color}~` : w.color)).join(' ');
  }
  if (m.moduleId === BUTTON_MODULE_ID) {
    const d = m.data as ButtonState;
    return `${d.color} button "${d.label}"`;
  }
  if (m.moduleId === PASSWORDS_MODULE_ID) {
    const d = m.data as PasswordsState;
    return `showing ${d.positions.map((p, i) => d.columns[i]?.[p] ?? '?').join('')}`;
  }
  return '';
}

function renderBotTable(s: Swarm): string {
  if (s.all.length === 0) return `<div class="empty">no bots</div>`;
  const session = s.players[0]?.session ?? s.facilitator?.session ?? null;
  const rows = s.all
    .map((b, i) => {
      const dropped = session?.disconnectedPlayerIds.includes(b.playerId ?? '') ?? false;
      const cls = [b.isCurrentDefuser ? 'defuser' : '', dropped ? 'dropped' : ''].filter(Boolean).join(' ');
      const conn = b.connected ? `<span class="pill ok">up</span>` : `<span class="pill bad">down</span>`;
      const role = b.role ? `<span class="pill ${b.role === 'defuser' ? 'defuser' : 'dim'}">${b.role}</span>` : `<span class="pill dim">—</span>`;
      const ready = b.isReady ? `<span class="pill ok">ready</span>` : `<span class="pill dim">not</span>`;
      // strikes/result are shown only for the round they belong to, so a finished
      // round's bot doesn't display stale "exploded" / "1/3" once a new round arms.
      const fresh = session != null && b.roundTag === session.roundNumber;
      const resolved =
        b.resolved && fresh
          ? `<span class="pill ${b.resolved === 'defused' ? 'ok' : 'bad'}">${b.resolved}</span>`
          : '';
      const strikes =
        b.strikes > 0 && fresh
          ? `<span class="pill ${b.strikes >= 3 ? 'bad' : 'warn'}">${b.strikes}/3</span>`
          : `<span class="dim">0</span>`;
      const isFac = b.role === 'facilitator' || b === s.facilitator;
      return `
      <tr class="${cls}">
        <td><b>${escapeHtml(b.displayName)}</b>${b.isCurrentDefuser ? ' 🎯' : ''}${b.driving ? ' <span class="pill warn">driving</span>' : ''}</td>
        <td>${conn}</td>
        <td>${b.team ?? '—'}</td>
        <td>${role}</td>
        <td>${ready}</td>
        <td>${strikes}</td>
        <td>${resolved}</td>
        <td class="tbtns">
          ${isFac ? '' : `<button data-action="ready-toggle" data-bot="${i}">${b.isReady ? 'Unready' : 'Ready'}</button>`}
          ${b.connected
            ? `<button data-action="disconnect" data-bot="${i}">Disconnect</button>`
            : `<button class="warn" data-action="reconnect" data-bot="${i}">Reconnect</button>`}
          ${isFac ? '' : `
            <button data-action="solve" data-bot="${i}" ${b.canDrive ? '' : 'disabled'}>Solve</button>
            <button class="bad" data-action="detonate" data-bot="${i}" ${b.canDrive ? '' : 'disabled'}>Detonate</button>
            <button class="warn" data-action="strike" data-bot="${i}" ${b.canDrive ? '' : 'disabled'} title="one strike">+1 strike</button>
            <select data-outcome data-bot="${i}" title="auto-mode on each BOMB_INIT">
              ${(['manual', 'defuse', 'strike', 'timeout'] as Outcome[])
                .map((o) => `<option value="${o}" ${b.outcome === o ? 'selected' : ''}>${o}</option>`)
                .join('')}
            </select>`}
        </td>
        <td class="err" title="${escapeHtml(b.lastError ?? '')}">${escapeHtml(b.lastError ?? '')}</td>
      </tr>`;
    })
    .join('');
  return `
  <table>
    <thead>
      <tr><th>Bot</th><th>Conn</th><th>Team</th><th>Role</th><th>Ready</th><th>Strikes</th><th>Result</th><th>Actions</th><th>Last error</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="hint">🎯 = current Defuser (the only seat the server lets interact). Solve/Detonate enable only for the active Defuser of a running, un-paused round.</p>`;
}

function renderLogCard(): string {
  return `<div class="card"><h2>Event log</h2><div id="log"></div></div>`;
}

function renderLogInto(): void {
  const el = document.getElementById('log');
  if (!el) return;
  el.innerHTML = logLines.slice(-300).join('\n');
  el.scrollTop = el.scrollHeight;
}

// ─── Live bomb-timer ticker ──────────────────────────────────────────────────
// Runs at 4 Hz, independent of the event-driven re-render, and patches ONLY the
// timer element so the countdown is smooth without repainting the dashboard. The
// timer is computed from the active Defuser's mirrored TimerState (Model B: one
// active team per round) using the same formula the real client renders.

function activeTimer(): { remaining: number; speed: number; paused: boolean } | null {
  const session = swarm?.players[0]?.session ?? swarm?.facilitator?.session ?? null;
  if (!session || session.status !== 'active') return null;
  const defuser = swarm?.all.find((b) => b.isCurrentDefuser && b.timer);
  const t = defuser?.timer;
  if (!t) return null;
  return { remaining: timerRemainingMs(t, Date.now()), speed: t.speedMultiplier, paused: t.pausedAt != null };
}

setInterval(() => {
  const el = document.getElementById('bomb-timer');
  if (!el) return;
  const t = activeTimer();
  if (!t) {
    el.textContent = '—';
    el.className = 'timer';
    return;
  }
  el.textContent = formatTimerDisplay(t.remaining) + (t.speed > 1 ? ` ×${t.speed.toFixed(2)}` : '');
  el.className = 'timer' + (t.paused ? ' paused' : t.remaining < 30_000 ? ' low' : '');
}, 250);

// Mode-change: show join code field only in Join mode (cosmetic affordance).
app.addEventListener('mode-change', () => {
  const mode = (document.getElementById('f-mode') as HTMLSelectElement)?.value;
  const code = document.getElementById('f-code') as HTMLInputElement | null;
  if (code) code.style.display = mode === 'create' ? 'none' : '';
});

render();
pushLog('Panel ready. Configure and spawn a swarm.');
