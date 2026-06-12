import {
  sessionKey,
  roundKey,
  bombKey,
  timerKey,
  rolesKey,
  lifelinesKey,
} from '../keys.js';

describe('Redis key-builders — exact string assertions', () => {
  it('sessionKey', () => {
    expect(sessionKey('S1')).toBe('session:S1');
  });

  it('roundKey', () => {
    expect(roundKey('S1', 2)).toBe('session:S1:round:2');
  });

  it('bombKey', () => {
    expect(bombKey('S1', 'red')).toBe('session:S1:team:red:bomb');
  });

  it('timerKey', () => {
    expect(timerKey('S1', 'red')).toBe('session:S1:team:red:timer');
  });

  it('rolesKey', () => {
    expect(rolesKey('S1')).toBe('session:S1:roles');
  });

  it('lifelinesKey', () => {
    expect(lifelinesKey('S1')).toBe('session:S1:lifelines');
  });

  it('all keys are colon-delimited and contain no wildcard/glob chars', () => {
    const keys = [
      sessionKey('abc'),
      roundKey('abc', 1),
      bombKey('abc', 'blue'),
      timerKey('abc', 'blue'),
      rolesKey('abc'),
      lifelinesKey('abc'),
    ];
    for (const key of keys) {
      expect(key).toMatch(/^[a-z0-9:]+$/);
      expect(key).not.toMatch(/[*?\[\]]/);
    }
  });
});
