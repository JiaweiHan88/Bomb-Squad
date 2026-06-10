import type { ModuleState } from './module.js';

export type IndicatorLabel =
  | 'SND' | 'CLR' | 'CAR' | 'IND' | 'FRQ' | 'SIG'
  | 'NSA' | 'MSA' | 'TRN' | 'BOB' | 'FRK';

export type PortType =
  | 'DVI-D' | 'Parallel' | 'PS/2' | 'RJ-45' | 'Serial' | 'Stereo RCA';

export interface BombContext {
  /**
   * Last character is always a digit (0–9).
   * Used by module rules: serial-number last-digit checks (Complicated Wires S-code,
   * Wire Sequences), serial-vowel checks (Simon Says), and others.
   */
  readonly serialNumber: string;
  readonly batteryCount: number;
  readonly indicators: ReadonlyArray<{ readonly label: IndicatorLabel; readonly lit: boolean }>;
  readonly ports: ReadonlyArray<PortType>;
}

export interface BombState {
  /** Read-only per-team-round metadata. Never mutated after generation. */
  context: Readonly<BombContext>;
  modules: ModuleState<unknown>[];
  /** Team-wide strike count. Range: 0–3; third strike triggers explosion. */
  strikes: number;
  solved: boolean;
}
