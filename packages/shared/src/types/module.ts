import type { BombContext } from './bomb.js';
import type { Reducer } from './reducer.js';

export interface ManualTable {
  headers: string[];
  rows: string[][];
}

export interface ManualSection {
  heading?: string;
  /** Plain text content or a structured description for rendering. */
  content: string;
  table?: ManualTable;
}

/** Structured manual content. NOT raw HTML or untyped JSX. */
export interface ManualPage {
  chapterId: string;
  chapterTitle: string;
  sections: ManualSection[];
}

export interface ModuleState<S> {
  /** Module identifier in kebab-case, e.g. "wires", "simon-says". */
  moduleId: string;
  /**
   * 'struck' is transient — the bomb reducer rolls it up into a team strike and
   * resets status back to 'armed'. Reducers return 'struck' to signal a wrong
   * interaction; they never hold that status permanently.
   */
  status: 'armed' | 'solved' | 'struck';
  data: S;
}

export interface IModule<S = unknown, A = unknown> {
  /** Module identifier in kebab-case, e.g. "wires", "simon-says". */
  readonly id: string;

  /** Pure, seeded. The ONLY place randomness is allowed in a module. */
  generate(seed: number, ctx: BombContext): S;

  /** Pure reducer for this module's actions. */
  reduce: Reducer<ModuleState<S>, A>;

  /** Returns structured manual content. NOT raw HTML or untyped JSX. */
  getManualPages(): ManualPage[];

  /** Optional needy-module lifecycle hook (V2). Default: no-op. */
  onTick?(state: ModuleState<S>, now: number): ModuleState<S>;
}
