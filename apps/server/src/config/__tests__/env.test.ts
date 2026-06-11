import { parseEnv, EnvValidationError } from '../env.js';

const validEnv = {
  PORT: '3001',
  REDIS_URL: 'redis://localhost:6379',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/bombsquad',
  LIVEKIT_URL: 'ws://localhost:7880',
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'devsecret',
  TURN_SECRET: 'changeme',
  TURN_TTL: '86400',
} as const;

describe('parseEnv', () => {
  it('parses a valid env object into a typed, numerically-coerced config', () => {
    const config = parseEnv({ ...validEnv });

    expect(config.PORT).toBe(3001);
    expect(typeof config.PORT).toBe('number');
    expect(config.TURN_TTL).toBe(86400);
    expect(typeof config.TURN_TTL).toBe('number');
    expect(config.REDIS_URL).toBe('redis://localhost:6379');
    expect(config.LIVEKIT_API_SECRET).toBe('devsecret');
  });

  it('throws EnvValidationError naming a missing required key', () => {
    const { REDIS_URL, ...missing } = validEnv;

    expect(() => parseEnv(missing)).toThrow(EnvValidationError);
    try {
      parseEnv(missing);
      throw new Error('expected parseEnv to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      expect((err as EnvValidationError).issues.join(' ')).toContain('REDIS_URL');
    }
  });

  it('names every missing key when several are absent', () => {
    const { REDIS_URL, DATABASE_URL, ...missing } = validEnv;

    try {
      parseEnv(missing);
      throw new Error('expected parseEnv to throw');
    } catch (err) {
      const joined = (err as EnvValidationError).issues.join(' ');
      expect(joined).toContain('REDIS_URL');
      expect(joined).toContain('DATABASE_URL');
    }
  });

  it('rejects a present-but-blank required var (e.g. REDIS_URL=)', () => {
    expect(() => parseEnv({ ...validEnv, REDIS_URL: '' })).toThrow(EnvValidationError);
    try {
      parseEnv({ ...validEnv, REDIS_URL: '' });
      throw new Error('expected parseEnv to throw');
    } catch (err) {
      expect((err as EnvValidationError).issues.join(' ')).toContain('REDIS_URL');
    }
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => parseEnv({ ...validEnv, PORT: 'not-a-number' })).toThrow(/PORT/);
  });

  it('rejects a non-positive PORT', () => {
    expect(() => parseEnv({ ...validEnv, PORT: '0' })).toThrow(/PORT/);
  });

  it('rejects a non-numeric TURN_TTL', () => {
    expect(() => parseEnv({ ...validEnv, TURN_TTL: 'soon' })).toThrow(/TURN_TTL/);
  });

  it('rejects non-decimal PORT forms that Number() would silently accept', () => {
    for (const PORT of ['0x10', '1e3', ' 3001 ', '+3001', '3001.0']) {
      expect(() => parseEnv({ ...validEnv, PORT })).toThrow(/PORT/);
    }
  });

  it('rejects a PORT above the TCP range (65535)', () => {
    expect(() => parseEnv({ ...validEnv, PORT: '70000' })).toThrow(/PORT/);
    expect(() => parseEnv({ ...validEnv, PORT: '99999999999999999999' })).toThrow(/PORT/);
  });

  it('accepts the TCP boundary ports', () => {
    expect(parseEnv({ ...validEnv, PORT: '1' }).PORT).toBe(1);
    expect(parseEnv({ ...validEnv, PORT: '65535' }).PORT).toBe(65535);
  });
});
