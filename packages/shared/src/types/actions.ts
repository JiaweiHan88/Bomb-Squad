/**
 * Discriminated union of all actions the bomb reducer handles.
 *
 * MODULE_ACTION is the only variant for this story.
 * Bomb-level timer / pause actions (TIMER_TICK, PAUSE, RESUME) are deferred to Story 8.4
 * (server-authoritative timer & strike escalation).
 */
export type BombAction =
  | { type: 'MODULE_ACTION'; moduleIndex: number; payload: unknown };
