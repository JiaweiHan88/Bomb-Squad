import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getIdentity, setIdentity, clearIdentity, applyAuthFromIdentity } from '../identity.js';
import type { AppClientSocket } from '../socket.js';

/** Minimal in-memory sessionStorage stand-in (the node test env has none). */
function installSessionStorage(): void {
  const data = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  });
}

const IDENTITY = { sessionId: 'sess-1', playerId: 'player-1', reattachToken: 'secret-token' };

describe('net/identity', () => {
  beforeEach(() => {
    installSessionStorage();
  });

  it('round-trips a stored identity', () => {
    expect(getIdentity()).toBeNull();
    setIdentity(IDENTITY);
    expect(getIdentity()).toEqual(IDENTITY);
  });

  it('clearIdentity forgets it', () => {
    setIdentity(IDENTITY);
    clearIdentity();
    expect(getIdentity()).toBeNull();
  });

  it('returns null for a malformed / partial stored value', () => {
    sessionStorage.setItem('bombsquad:identity', JSON.stringify({ sessionId: 'x' }));
    expect(getIdentity()).toBeNull();
  });

  it('applyAuthFromIdentity pushes only sessionId + token onto socket.auth (token is the credential)', () => {
    setIdentity(IDENTITY);
    const socket = { auth: {} } as unknown as AppClientSocket;
    applyAuthFromIdentity(socket);
    expect(socket.auth).toEqual({ sessionId: 'sess-1', reattachToken: 'secret-token' });
  });

  it('applyAuthFromIdentity leaves auth empty when there is no stored identity', () => {
    const socket = { auth: { stale: true } } as unknown as AppClientSocket;
    applyAuthFromIdentity(socket);
    expect(socket.auth).toEqual({});
  });

  it('degrades gracefully when sessionStorage is unavailable', () => {
    vi.stubGlobal('sessionStorage', undefined);
    expect(() => setIdentity(IDENTITY)).not.toThrow();
    expect(getIdentity()).toBeNull();
    expect(() => clearIdentity()).not.toThrow();
  });
});
