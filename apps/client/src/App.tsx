// Type-only import — verifies cross-workspace resolution; erased at runtime.
import type { BombState } from '@bomb-squad/shared';

// Smoke-test: ensure BombState is usable as a type annotation.
type _BombStateCheck = BombState;

export default function App() {
  return (
    <div style={{ fontFamily: 'monospace', padding: '2rem' }}>
      <h1>Bomb Squad — booting…</h1>
      <p>Scaffold placeholder. Game logic coming in later stories.</p>
    </div>
  );
}
