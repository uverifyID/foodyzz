// Runs before each test file (jest `setupFiles`), before src/index.ts is imported.
// `firebase emulators:exec` already injects these when running via `npm test`; we
// set sane defaults so `jest` can also be pointed at a separately-started emulator.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-foodyzz';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
// Quiet the functions' own console noise during tests; comment out to debug.
process.env.FUNCTIONS_EMULATOR = 'true';
