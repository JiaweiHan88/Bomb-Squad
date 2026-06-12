/** Single source of truth for the Redis keyspace. All key segments join with `:`. */

export const sessionKey = (sessionId: string): string =>
  `session:${sessionId}`;

export const roundKey = (sessionId: string, roundNumber: number): string =>
  `session:${sessionId}:round:${roundNumber}`;

export const bombKey = (sessionId: string, teamId: string): string =>
  `session:${sessionId}:team:${teamId}:bomb`;

export const timerKey = (sessionId: string, teamId: string): string =>
  `session:${sessionId}:team:${teamId}:timer`;

export const rolesKey = (sessionId: string): string =>
  `session:${sessionId}:roles`;

export const lifelinesKey = (sessionId: string): string =>
  `session:${sessionId}:lifelines`;

/**
 * Most recent Expert manual position for the session (value: JSON
 * `{ chapterId, playerId }`). Last write wins — that IS the locked-mirror
 * semantic from GDD A3 (spectator manual follows the most-recently-navigated
 * Expert). Single-key O(1) write per navigation.
 */
export const manualPositionKey = (sessionId: string): string =>
  `session:${sessionId}:manualPosition`;

/** Join-code → sessionId lookup (value: the sessionId string, stored as JSON). */
export const joinCodeKey = (joinCode: string): string =>
  `joincode:${joinCode}`;
