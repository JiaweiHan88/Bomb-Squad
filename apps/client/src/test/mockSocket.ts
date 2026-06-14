import { vi } from 'vitest';
import type { AppClientSocket } from '../net/socket.js';

/**
 * A fake of the app's typed Socket.IO client for component tests.
 *
 * It mirrors only the surface the UI actually uses (see `Landing.tsx`):
 *   - `emit(EVENT, payload)`            — fire-and-forget (e.g. SESSION_JOIN)
 *   - `timeout(ms).emit(EVENT, p, ack)` — error-first ack (e.g. SESSION_CREATE)
 *   - `on(EVENT, handler)` / `off(...)` — server-pushed events (e.g. ERROR)
 *   - `id`, `connected`
 *
 * Type-safety note: `socket` is cast (`as unknown as AppClientSocket`), so the
 * component-under-test that calls `getSocket().emit(...)` is still fully typed — it
 * cannot emit an unknown event. The `.emit` / `.timeoutEmit` SPIES, however, are bare
 * `vi.fn()`, so assertion sites (`mock.emit.toHaveBeenCalledWith('SESSION_JOIN', …)`)
 * are NOT compile-checked — a typo'd event name there will not fail typecheck. Keep
 * assertion event names/payloads accurate by reading them off the component.
 *
 * Assert outgoing events on `.emit` / `.timeoutEmit`; simulate a server push with
 * `.fire(EVENT, ...args)`. Wire it into a test with `vi.mock` (see src/test/README.md):
 *
 *   vi.mock('../../net/socket.js', () => ({ getSocket: vi.fn(), createSocket: vi.fn() }));
 *   import { getSocket } from '../../net/socket.js';
 *   const mock = createMockSocket();
 *   vi.mocked(getSocket).mockReturnValue(mock.socket);
 */
export interface MockSocket {
  /** Cast to the real typed socket — pass this where `getSocket()` is expected. */
  socket: AppClientSocket;
  /** Spy for plain `socket.emit(event, payload)`. */
  emit: ReturnType<typeof vi.fn>;
  /** Spy for the ack-style emit produced by `socket.timeout(ms).emit(...)`. */
  timeoutEmit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  id: string;
  /** Invoke handlers registered via `.on(event, h)` — e.g. simulate an ERROR push. */
  fire: (event: string, ...args: unknown[]) => void;
}

export function createMockSocket(id = 'socket-test-id'): MockSocket {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const emit = vi.fn(() => socket);
  const timeoutEmit = vi.fn(() => socket);
  const timeout = vi.fn(() => ({ emit: timeoutEmit }));
  const on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    let set = handlers.get(event);
    if (!set) {
      set = new Set();
      handlers.set(event, set);
    }
    set.add(handler);
    return socket;
  });
  const off = vi.fn((event: string, handler?: (...args: unknown[]) => void) => {
    if (handler) handlers.get(event)?.delete(handler);
    else handlers.delete(event);
    return socket;
  });
  const fire = (event: string, ...args: unknown[]) => {
    handlers.get(event)?.forEach((handler) => handler(...args));
  };

  // Only the used surface is implemented; cast through `unknown` to the full type.
  const socket = {
    id,
    connected: true,
    emit,
    on,
    off,
    timeout,
  } as unknown as AppClientSocket;

  return { socket, emit, timeoutEmit, on, off, id, fire };
}
