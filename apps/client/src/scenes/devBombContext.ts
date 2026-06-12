import type { BombContext } from '@bomb-squad/shared';

/**
 * Fixed dev-harness BombContext for the /dev/bomb route, matching the
 * Defuser Bomb View mockup. Real contexts are generated server-side from the
 * team seed (Story 8.2) and arrive via BOMB_INIT — once gameStore.bomb exists,
 * the scene renders that instead of this constant.
 *
 * A constant, NOT a generator: Math.random() is forbidden outside
 * generate(seed, ctx). Last serial char must be a digit (BombContext contract).
 */
export const DEV_BOMB_CONTEXT: BombContext = {
  serialNumber: 'KTANE5',
  batteryCount: 2,
  indicators: [
    { label: 'FRK', lit: true },
    { label: 'CAR', lit: false },
  ],
  ports: ['Parallel', 'PS/2'],
};
