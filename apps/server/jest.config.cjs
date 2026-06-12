/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  // Only *.test.ts files are suites — __tests__/ also hosts shared harnesses
  // (e.g. handlers/__tests__/testSocketServer.ts) that must not be collected.
  testMatch: ['**/__tests__/**/*.test.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    // Strip the NodeNext `.js` extension so tests resolve the `.ts` sources.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    // Transpile-only via tsconfig's `isolatedModules: true`. Required here (unlike
    // packages/shared) because server tests import @bomb-squad/shared's .ts source,
    // which lives outside the server tsconfig's rootDir — full ts-jest type-checking
    // would raise TS6059. Type-checking is owned by the `tsc --noEmit` pre-commit gate.
    '^.+\\.ts$': ['ts-jest', { useESM: true }],
  },
};
