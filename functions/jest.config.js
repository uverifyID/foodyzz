/** Jest config for the Cloud Functions test suite.
 *
 * Runs under `firebase emulators:exec` (see package.json "test"), which injects
 * FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST / GCLOUD_PROJECT so the
 * admin SDK in src/index.ts auto-connects to the local emulator.
 *
 * ts-jest is forced to CommonJS (the base tsconfig uses NodeNext, which jest
 * doesn't run natively) and `noUnusedLocals` is relaxed so test scaffolding
 * doesn't fail compilation. Production builds still use the strict base tsconfig.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  setupFiles: ['<rootDir>/src/__tests__/jest.setup.ts'],
  testTimeout: 30000,
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        moduleResolution: 'node',
        esModuleInterop: true,
        noUnusedLocals: false,
        noUnusedParameters: false,
      },
    }],
  },
};
