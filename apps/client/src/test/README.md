# Client component tests — conventions

This directory holds the shared wiring for **React component tests** (added by Story TD-1).
The client test runner is **Vitest** (`vitest run`); component tests run in the **jsdom**
environment configured in `apps/client/vite.config.ts` (`test.environment = 'jsdom'`,
`setupFiles: ['./src/test/setup.ts']`).

- `setup.ts` — runs once before the suite: registers `@testing-library/jest-dom` matchers
  (`toBeInTheDocument`, …) and `afterEach(cleanup)` to unmount rendered trees.
- `mockSocket.ts` — the canonical fake for the typed Socket.IO client.

## Philosophy

Test components the way a **user** sees them: query by accessible **role / label / text**,
drive interactions with `@testing-library/user-event`, and assert on **visible behaviour and
outgoing socket events** — never on props, state, or component internals. If a component needs
a logic test, the logic has leaked out of a reducer/helper and should move there
(see `project-context.md` → "R3F components are rendering-only").

## Pattern 1 — mocking the typed socket

`getSocket()` (`src/net/socket.ts`) throws unless `createSocket()` ran first, so component
tests mock the module. Because `vi.mock` is hoisted, mock the module factory, then inject the
fake from `createMockSocket()`:

```ts
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSocket, type MockSocket } from '../../test/mockSocket.js';

vi.mock('../../net/socket.js', () => ({ getSocket: vi.fn(), createSocket: vi.fn() }));
import { getSocket } from '../../net/socket.js';
import { Landing } from '../Landing.js';

let mock: MockSocket;
beforeEach(() => {
  mock = createMockSocket();
  vi.mocked(getSocket).mockReturnValue(mock.socket);
});

it('emits SESSION_JOIN when a player joins', async () => {
  const user = userEvent.setup();
  render(<Landing />);
  await user.type(screen.getByLabelText('Your name'), 'Maya');
  await user.click(screen.getByRole('button', { name: 'Defuser' }));
  // Landing auto-submits when the 6th code cell is filled — there is no Join button.
  const cells = screen.getAllByLabelText(/Join code character/i);
  for (let i = 0; i < cells.length; i++) await user.type(cells[i]!, 'ABCDEF'[i]!);
  expect(mock.emit).toHaveBeenCalledWith(
    'SESSION_JOIN',
    expect.objectContaining({ joinCode: 'ABCDEF', displayName: 'Maya', role: 'defuser' }),
  );
});
```

- Plain emits land on `mock.emit`; ack-style `socket.timeout(ms).emit(EVENT, payload, ack)`
  lands on `mock.timeoutEmit` (grab the ack with `mock.timeoutEmit.mock.calls[0][2]` and call it
  to simulate success/timeout).
- Simulate a server push (e.g. `ERROR`) with `mock.fire('ERROR', { code: 'SESSION_FULL' })`.

Seed Zustand state via the store's own API (e.g. `useGameStore.setState(...)` / its actions) in
`beforeEach`; never reach into store internals.

## Pattern 2 — stubbing `@react-three/fiber` (R3F / WebGL)

jsdom has **no WebGL/canvas**, so any component tree that transitively reaches the 3D bomb
scene (`<Canvas>`, `useFrame`, `useThree`, drei helpers) will throw. The plain-DOM `src/ui/`
components don't need this, but anything that renders a `DefuserView` / `BombScene` does. Stub
the module at the top of the test file:

```ts
// Render R3F children as plain DOM and no-op the hooks so jsdom doesn't touch WebGL.
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: React.ReactNode }) => <div data-testid="r3f-canvas">{children}</div>,
  useFrame: () => undefined,
  useThree: () => ({}),
}));
// If the tree uses drei helpers, stub the specific imports too:
// vi.mock('@react-three/drei', () => ({ OrbitControls: () => null, /* … */ }));
```

Keep the stub minimal — add only the exports the component under test actually imports. The
goal is to test the component's **DOM/logic shell**, not the WebGL render; real 3D rendering is
verified by the scene unit tests plus the interactive human-verify in the 4.x stories.
