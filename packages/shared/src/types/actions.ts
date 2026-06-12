/**
 * Discriminated union of all actions the bomb reducer handles.
 *
 * - MODULE_ACTION — a defuser interaction routed to one module's reducer.
 * - MODULE_RESET  — a lifecycle signal that restores a module to its initial
 *   state. The bomb reducer delegates it to the module's own reducer (the module
 *   owns its initial state); reset bypasses the solved-inert guard, so a solved
 *   module returns to 'armed'. Module reducers recognise it by the `type`
 *   discriminator on the action they receive.
 *
 * Bomb-level timer / pause actions (TIMER_TICK, PAUSE, RESUME) are deferred to Story 8.4
 * (server-authoritative timer & strike escalation).
 */
export type BombAction =
  | { type: 'MODULE_ACTION'; moduleIndex: number; payload: unknown }
  | { type: 'MODULE_RESET'; moduleIndex: number };
