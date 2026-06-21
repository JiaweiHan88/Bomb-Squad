/**
 * Module solvers — compute the correct (or a deliberately wrong) interaction for
 * a module from its PUBLIC broadcast state, delegating to the shared pure solve
 * functions. No baked answer is read: `solutionIndex` was removed at the source
 * (5.3 fix), so a bot recomputes the answer the same way a human Defuser reading
 * the manual would. This is what keeps the simulator faithful, not a back-door.
 *
 * The solve logic lives in @bomb-squad/shared (framework-free), so importing it
 * here pulls in no react/socket runtime.
 */
import {
  type ModuleState,
  type BombContext,
  WIRES_MODULE_ID,
  type WiresState,
  type WiresAction,
  solveWires,
  BUTTON_MODULE_ID,
  type ButtonState,
  type ButtonAction,
  decideButton,
  releaseDigitFor,
  PASSWORDS_MODULE_ID,
  type PasswordsState,
  type PasswordsAction,
  PASSWORD_WORDS,
  LETTERS_PER_COLUMN,
} from '@bomb-squad/shared';

/**
 * One step in a solve plan. `emit` is an immediate MODULE_INTERACT action;
 * `release-on-digit` is the button HOLD case — the caller presses, then watches
 * the live timer and emits RELEASE once the displayed digits include `digit`
 * (the reducer checks `timerDigits.includes(...)`). Modelled as a step rather
 * than baked into the action because only the caller has the live TimerState.
 */
export type SolveStep =
  | { kind: 'emit'; action: WiresAction | ButtonAction | PasswordsAction }
  | { kind: 'release-on-digit'; digit: number };

/**
 * The ordered moves that solve `module`, or `null` if this module type is not
 * understood (an un-generatable module should never reach a bomb, but stay safe).
 */
export function solveModule(module: ModuleState<unknown>): SolveStep[] | null {
  switch (module.moduleId) {
    case WIRES_MODULE_ID: {
      const data = module.data as WiresState;
      const wireIndex = solveWires(
        data.wires.map((w) => w.color),
        data.ctx,
      );
      return [{ kind: 'emit', action: { type: 'CUT', wireIndex } }];
    }
    case BUTTON_MODULE_ID: {
      const data = module.data as ButtonState;
      const decision = decideButton(data.color, data.label, data.ctx);
      if (decision === 'tap') {
        // Tap-answer solves on any release; the timer is irrelevant.
        return [
          { kind: 'emit', action: { type: 'PRESS' } },
          { kind: 'emit', action: { type: 'RELEASE', timerDigits: [] } },
        ];
      }
      // Hold-answer: press, then release when the displayed time shows the digit.
      return [
        { kind: 'emit', action: { type: 'PRESS' } },
        { kind: 'release-on-digit', digit: releaseDigitFor(data.stripColor) },
      ];
    }
    case PASSWORDS_MODULE_ID: {
      const data = module.data as PasswordsState;
      const target = uniqueSpellableWord(data.columns);
      if (target === null) return null; // generation guarantees exactly one — defensive
      const steps: SolveStep[] = [];
      for (let col = 0; col < data.columns.length; col++) {
        const cur = data.positions[col];
        const goal = data.columns[col].indexOf(target[col]);
        // CYCLE 'up' advances +1 mod 6; emit the minimal number of up-steps.
        const ups = (((goal - cur) % LETTERS_PER_COLUMN) + LETTERS_PER_COLUMN) % LETTERS_PER_COLUMN;
        for (let i = 0; i < ups; i++) {
          steps.push({ kind: 'emit', action: { type: 'CYCLE', columnIndex: col, direction: 'up' } });
        }
      }
      steps.push({ kind: 'emit', action: { type: 'SUBMIT' } });
      return steps;
    }
    default:
      return null;
  }
}

/**
 * A single deliberately-wrong action that produces a strike on `module`, or
 * `null` if this module type cannot be struck by one action (a tap-answer button
 * always solves on release, so it has no one-shot strike). Used by `--outcome
 * strike`; the caller falls through to the next module when this returns null.
 */
export function strikeModule(module: ModuleState<unknown>): SolveStep[] | null {
  switch (module.moduleId) {
    case WIRES_MODULE_ID: {
      const data = module.data as WiresState;
      if (data.wires.length < 2) return null; // a single wire is the answer — can't miss
      const right = solveWires(
        data.wires.map((w) => w.color),
        data.ctx,
      );
      // Each strike must cut a DIFFERENT *uncut* wrong wire. Cutting an
      // already-severed wire is an idempotent no-op in the reducer (no second
      // strike), so a fixed index strikes at most once — pick the first uncut
      // wire that isn't the answer. Returns null once only the answer remains
      // uncut (cutting it would solve, not strike), so the caller moves on.
      for (let i = 0; i < data.wires.length; i++) {
        if (i !== right && !data.wires[i].cut) {
          return [{ kind: 'emit', action: { type: 'CUT', wireIndex: i } }];
        }
      }
      return null;
    }
    case BUTTON_MODULE_ID: {
      const data = module.data as ButtonState;
      const decision = decideButton(data.color, data.label, data.ctx);
      if (decision === 'tap') return null; // a tap always solves on release
      const wrong = (releaseDigitFor(data.stripColor) + 1) % 10;
      return [
        { kind: 'emit', action: { type: 'PRESS' } },
        { kind: 'emit', action: { type: 'RELEASE', timerDigits: [wrong] } },
      ];
    }
    case PASSWORDS_MODULE_ID: {
      const data = module.data as PasswordsState;
      // Submit a word that is not on the list: nudge one column off the solution.
      const steps: SolveStep[] = [
        { kind: 'emit', action: { type: 'CYCLE', columnIndex: 0, direction: 'up' } },
        { kind: 'emit', action: { type: 'SUBMIT' } },
      ];
      // If a single +1 on column 0 happens to still spell a listed word (rare),
      // it would solve instead of strike — guard by checking the resulting word.
      const goalLetter = data.columns[0][(data.positions[0] + 1) % LETTERS_PER_COLUMN];
      const candidate = goalLetter + data.positions.slice(1).map((p, i) => data.columns[i + 1][p]).join('');
      return (PASSWORD_WORDS as readonly string[]).includes(candidate) ? null : steps;
    }
    default:
      return null;
  }
}

/** Re-export for the caller: the timer-display digit extraction (mirrors the client). */
export { displayedTimerDigits } from './timerDigits.js';

/** The one word the columns can spell (generation guarantees exactly one), or null. */
function uniqueSpellableWord(columns: ReadonlyArray<ReadonlyArray<string>>): string | null {
  for (const word of PASSWORD_WORDS) {
    let spellable = true;
    for (let i = 0; i < word.length; i++) {
      if (!columns[i] || !columns[i].includes(word[i])) {
        spellable = false;
        break;
      }
    }
    if (spellable) return word;
  }
  return null;
}
