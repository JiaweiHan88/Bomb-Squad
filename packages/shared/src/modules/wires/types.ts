/**
 * wires — the walking-skeleton module (Story 5.3, AR5).
 *
 * 3–6 coloured wires; cut exactly one to disarm. The correct wire is decided
 * by the GDD per-wire-count rule tables (solve.ts) evaluated against the wire
 * colours and the bomb's serial number. Pure logic lives HERE in
 * packages/shared so both the server registry (MODULE_REDUCERS, runtime via
 * tsx) and the client sandbox can run it; apps/client/src/modules/wires/
 * re-exports it (game-architecture.md Pattern 3: "or re-export from shared").
 */

/** Module identifier — kebab-case (project naming convention). */
export const WIRES_MODULE_ID = 'wires';

/** The only five colours the GDD rule tables reference. */
export const WIRE_COLORS = ['red', 'white', 'blue', 'yellow', 'black'] as const;

export type WireColor = (typeof WIRE_COLORS)[number];

/**
 * Mono letter label rendered beside each wire (colorblind floor: colour is
 * never the only signal — DESIGN.md accessibility gate). K for black avoids
 * the B collision with blue; the manual documents the same lettering so both
 * sides of the information asymmetry share it.
 */
export const WIRE_COLOR_LABELS: Readonly<Record<WireColor, string>> = {
  red: 'R',
  white: 'W',
  blue: 'B',
  yellow: 'Y',
  black: 'K',
};

export interface WiresWire {
  readonly color: WireColor;
  /** A severed wire stays severed until MODULE_RESET (cuts are physical). */
  readonly cut: boolean;
}

export interface WiresState {
  readonly wires: ReadonlyArray<WiresWire>;
  /**
   * 0-based index of the one correct wire, baked in by generate() via
   * solveWires() — the dev-demo precedent of deriving the authoritative
   * answer from the same rule data the Expert's manual renders, so solver
   * and manual cannot diverge. Not a secret: the manual rules are public,
   * so the answer is always derivable from the visible colours + serial.
   */
  readonly solutionIndex: number;
}

/** Defuser action — wire cut = single click (the sole interaction primitive). */
export type WiresAction = { type: 'CUT'; wireIndex: number };

/** Lifecycle action forwarded whole by the bomb reducer (see types/actions.ts). */
export type WiresReset = { type: 'MODULE_RESET' };

/** Runtime guard: actions reach reducers as `unknown` (untrusted input). */
export function isWiresAction(action: unknown): action is WiresAction | WiresReset {
  if (typeof action !== 'object' || action === null || !('type' in action)) return false;
  const type = (action as { type: unknown }).type;
  if (type === 'MODULE_RESET') return true;
  return type === 'CUT' && typeof (action as { wireIndex?: unknown }).wireIndex === 'number';
}
