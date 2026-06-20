/**
 * Relay-orchestration predicates (Story 8.9, FR43/FR44).
 *
 * The implementations moved to `@bomb-squad/shared` (Story 8.8) so the client's
 * facilitator relay UX (relay-complete notice + equalisation-volunteer picker)
 * reads the SAME pure predicates the server authority does — they can never
 * drift. This module re-exports them so the existing server import sites
 * (`startRound`, `equalisationVolunteer`, `sessionHandlers`, the tests) keep
 * their `../relayComplete.js` path unchanged.
 */
export {
  maxRelayLength,
  naturalRoundRemains,
  equalisationRoundsOwed,
  totalEqualisationOwed,
  isRelayComplete,
} from '@bomb-squad/shared';
