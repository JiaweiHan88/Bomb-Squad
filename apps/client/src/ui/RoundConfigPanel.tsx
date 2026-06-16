import type { DifficultyTier, ModuleId, RoundConfig } from '@bomb-squad/shared';
import { TIER_CATALOG, TIER_DEFAULTS, MODULE_GENERATORS } from '@bomb-squad/shared';
import { useGameStore } from '../store/gameStore.js';
import { getSocket } from '../net/socket.js';
import {
  ROUND_CONFIG_TITLE,
  DIFFICULTY_LABEL,
  TIER_EASY,
  TIER_MEDIUM,
  TIER_HARD,
  TIER_EASY_HINT,
  TIER_MEDIUM_HINT,
  TIER_HARD_HINT,
  TIMER_LABEL,
  MODULE_COUNT_LABEL,
  MODULE_COUNT_DECREMENT,
  MODULE_COUNT_INCREMENT,
  STRIKE_SPEEDUP_LABEL,
  MODIFIER_ASYMMETRIC,
  MODIFIER_ASYMMETRIC_SUB,
  MODIFIER_LIFELINES,
  MODIFIER_LIFELINES_SUB,
  MODULE_POOL_LABEL,
  MODULE_POOL_SUB,
  MODULE_POOL_COMING_SOON,
} from './copy.js';

const MIN_COUNT = 3;
const MAX_COUNT = 11;
const MIN_TIMER_MS = 180_000;
const MAX_TIMER_MS = 600_000;
const TIMER_STEP_MS = 15_000;
const MIN_PCT = 0;
const MAX_PCT = 50;
const PCT_STEP = 5;

const TIERS: readonly { id: DifficultyTier; label: string; hint: string }[] = [
  { id: 'easy', label: TIER_EASY, hint: TIER_EASY_HINT },
  { id: 'medium', label: TIER_MEDIUM, hint: TIER_MEDIUM_HINT },
  { id: 'hard', label: TIER_HARD, hint: TIER_HARD_HINT },
];

/** Human-readable module names for the pool chips (kebab id → title). */
const MODULE_LABELS: Record<ModuleId, string> = {
  wires: 'Wires',
  'the-button': 'The Button',
  passwords: 'Passwords',
  keypads: 'Keypads',
  'whos-on-first': "Who's on First",
  'wire-sequences': 'Wire Sequences',
  mazes: 'Mazes',
  'complicated-wires': 'Complicated Wires',
  'simon-says': 'Simon Says',
  memory: 'Memory',
  'morse-code': 'Morse Code',
};

/** Module ids with a registered generator — the only ones a bomb can build today. */
const GENERATABLE: ReadonlySet<string> = new Set(Object.keys(MODULE_GENERATORS));

function formatTimer(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Generatable modules of a tier — the effective default pool the dashboard shows as selected. */
function generatablePool(tier: DifficultyTier): ModuleId[] {
  return TIER_CATALOG[tier].filter((id) => GENERATABLE.has(id));
}

/**
 * Facilitator round-setup panel (Story 8.1, mockup Section A). Operator-world
 * styling only (dark surface + cream accent — NO bomb-chassis palette), no
 * fast-blink, no nested modals. Self-gated: renders only for the facilitator and
 * only in the pre-round windows (lobby / between-rounds), mirroring the server
 * ROUND_CONFIGURE phase guard.
 *
 * Server-truth-driven: every control derives from `session.config` and emits a
 * complete RoundConfig via ROUND_CONFIGURE; the SESSION_STATE broadcast
 * reconciles the view (no optimistic local state). Rejections surface through
 * the Lobby error banner (its ASSIGN_ERROR_CODES owns the ROUND_CONFIGURE codes).
 *
 * THE TWO-POOL SPLIT: pool chips are drawn from TIER_CATALOG (the full design
 * tiering); modules without a generator render disabled — the server would
 * reject them and generateLayout would throw. See registry.ts TIER_CATALOG.
 */
export default function RoundConfigPanel() {
  const session = useGameStore((s) => s.session);
  const selfId = useGameStore((s) => s.myPlayerId);

  if (session === null) return null;
  const isFacilitator = selfId !== null && session.players[selfId]?.role === 'facilitator';
  if (!isFacilitator) return null;
  if (session.status !== 'lobby' && session.status !== 'between-rounds') return null;

  const config = session.config;
  const emit = (next: RoundConfig) => {
    getSocket().emit('ROUND_CONFIGURE', { config: next });
  };

  // Selecting a tier resets the recommended count + timer and clears any pool
  // override back to the tier default (modulePool: undefined).
  const selectTier = (tier: DifficultyTier) => {
    if (tier === config.difficulty) return;
    const defaults = TIER_DEFAULTS[tier];
    emit({
      ...config,
      difficulty: tier,
      moduleCount: defaults.moduleCount,
      timerMs: defaults.timerMs,
      modulePool: undefined,
    });
  };

  const setCount = (next: number) => {
    const clamped = Math.max(MIN_COUNT, Math.min(MAX_COUNT, next));
    if (clamped === config.moduleCount) return;
    emit({ ...config, moduleCount: clamped });
  };

  const setTimer = (ms: number) => emit({ ...config, timerMs: ms });
  const setPct = (pct: number) => emit({ ...config, strikeSpeedUpPct: pct });
  const setModifier = (key: keyof RoundConfig['modifiers'], value: boolean) =>
    emit({ ...config, modifiers: { ...config.modifiers, [key]: value } });

  const tierPool = generatablePool(config.difficulty);
  const selected: readonly string[] = config.modulePool ?? tierPool;

  const togglePool = (id: ModuleId) => {
    const isOn = selected.includes(id);
    // Never let the pool empty out — generation needs at least one module.
    if (isOn && selected.length === 1) return;
    const nextSet = new Set(selected);
    if (isOn) nextSet.delete(id);
    else nextSet.add(id);
    // Preserve canonical tier order.
    const next = TIER_CATALOG[config.difficulty].filter((m) => nextSet.has(m));
    emit({ ...config, modulePool: next });
  };

  return (
    <section
      className="w-full max-w-sm rounded-lg bg-surface-raised p-8"
      aria-label={ROUND_CONFIG_TITLE}
    >
      <h2 className="mb-6 font-display text-lg font-semibold">{ROUND_CONFIG_TITLE}</h2>

      {/* Difficulty tier — segmented control */}
      <div className="mb-7">
        <p className="mb-3 text-sm font-semibold">{DIFFICULTY_LABEL}</p>
        <div className="grid grid-cols-3 gap-1.5 rounded-md border border-ink-muted/30 bg-surface p-1.5" role="group" aria-label={DIFFICULTY_LABEL}>
          {TIERS.map((tier) => {
            const active = config.difficulty === tier.id;
            return (
              <button
                key={tier.id}
                type="button"
                aria-pressed={active}
                onClick={() => selectTier(tier.id)}
                className={`cursor-pointer rounded-sm py-2 text-center text-sm font-semibold transition-colors ${
                  active ? 'bg-cream text-ink-manual' : 'text-ink-muted hover:text-ink-primary'
                }`}
              >
                {tier.label}
                <span className="block font-mono text-[9px] font-medium uppercase tracking-wider opacity-70">
                  {tier.hint}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Timer slider */}
      <div className="mb-7">
        <p className="mb-3 flex items-center justify-between text-sm font-semibold">
          {TIMER_LABEL}
          <span className="font-mono font-medium text-ink-muted" data-testid="timer-value">
            {formatTimer(config.timerMs)}
          </span>
        </p>
        <input
          type="range"
          aria-label={TIMER_LABEL}
          min={MIN_TIMER_MS}
          max={MAX_TIMER_MS}
          step={TIMER_STEP_MS}
          value={config.timerMs}
          onChange={(e) => setTimer(Number(e.target.value))}
          className="w-full cursor-pointer accent-cream"
        />
      </div>

      {/* Module count stepper */}
      <div className="mb-7">
        <p className="mb-3 text-sm font-semibold">{MODULE_COUNT_LABEL}</p>
        <div className="flex w-max items-center overflow-hidden rounded-md border border-ink-muted/30">
          <button
            type="button"
            aria-label={MODULE_COUNT_DECREMENT}
            disabled={config.moduleCount <= MIN_COUNT}
            onClick={() => setCount(config.moduleCount - 1)}
            className="h-10 w-10 cursor-pointer bg-surface text-xl text-ink-primary hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
          >
            −
          </button>
          <span
            className="w-14 border-x border-ink-muted/30 py-2 text-center font-mono text-lg font-bold"
            data-testid="module-count-value"
            aria-live="polite"
          >
            {config.moduleCount}
          </span>
          <button
            type="button"
            aria-label={MODULE_COUNT_INCREMENT}
            disabled={config.moduleCount >= MAX_COUNT}
            onClick={() => setCount(config.moduleCount + 1)}
            className="h-10 w-10 cursor-pointer bg-surface text-xl text-ink-primary hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>

      {/* Strike speed-up slider */}
      <div className="mb-7">
        <p className="mb-3 flex items-center justify-between text-sm font-semibold">
          {STRIKE_SPEEDUP_LABEL}
          <span className="font-mono font-medium text-ink-muted" data-testid="strike-speedup-value">
            {config.strikeSpeedUpPct}%
          </span>
        </p>
        <input
          type="range"
          aria-label={STRIKE_SPEEDUP_LABEL}
          min={MIN_PCT}
          max={MAX_PCT}
          step={PCT_STEP}
          value={config.strikeSpeedUpPct}
          onChange={(e) => setPct(Number(e.target.value))}
          className="w-full cursor-pointer accent-cream"
        />
      </div>

      {/* Modifier toggles */}
      <div className="mb-7 flex flex-col gap-4">
        <ModifierToggle
          label={MODIFIER_ASYMMETRIC}
          sub={MODIFIER_ASYMMETRIC_SUB}
          checked={config.modifiers.asymmetricExpertRoles}
          onToggle={(v) => setModifier('asymmetricExpertRoles', v)}
        />
        <ModifierToggle
          label={MODIFIER_LIFELINES}
          sub={MODIFIER_LIFELINES_SUB}
          checked={config.modifiers.spectatorLifelines}
          onToggle={(v) => setModifier('spectatorLifelines', v)}
        />
      </div>

      {/* Module pool override */}
      <div>
        <p className="text-sm font-semibold">{MODULE_POOL_LABEL}</p>
        <p className="mb-3 text-xs text-ink-muted">{MODULE_POOL_SUB}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label={MODULE_POOL_LABEL}>
          {TIER_CATALOG[config.difficulty].map((id) => {
            const generatable = GENERATABLE.has(id);
            const on = selected.includes(id);
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                disabled={!generatable}
                title={generatable ? undefined : MODULE_POOL_COMING_SOON}
                onClick={() => togglePool(id)}
                className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  on && generatable
                    ? 'border-cream bg-cream text-ink-manual'
                    : 'border-ink-muted/40 text-ink-muted hover:text-ink-primary'
                }`}
              >
                {MODULE_LABELS[id]}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ModifierToggle({
  label,
  sub,
  checked,
  onToggle,
}: {
  label: string;
  sub: string;
  checked: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs leading-snug text-ink-muted">{sub}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onToggle(!checked)}
        className={`relative h-7 w-12 shrink-0 cursor-pointer rounded-full border border-ink-muted/40 transition-colors ${
          checked ? 'bg-cream' : 'bg-surface'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
            checked ? 'left-[22px] bg-ink-manual' : 'left-0.5 bg-ink-muted'
          }`}
        />
      </button>
    </div>
  );
}
