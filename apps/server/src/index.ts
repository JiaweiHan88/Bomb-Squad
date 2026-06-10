// Type-only import — verifies cross-workspace resolution; erased at runtime.
import type { SessionState } from '@bomb-squad/shared';

// Smoke-test: ensure SessionState is usable as a type annotation.
type _SessionStateCheck = SessionState;

console.log('server placeholder — Fastify + Socket.IO bootstrap is Story 1.4');

