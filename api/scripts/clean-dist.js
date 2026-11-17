const { rm } = require('node:fs/promises');
const { resolve } = require('node:path');

// The incremental build cache must go with dist, or tsc thinks nothing changed
// and emits no files into the fresh dist folder.
const outputs = ['../dist', '../tsconfig.build.tsbuildinfo'].map((path) => resolve(__dirname, path));
Promise.all(outputs.map((output) => rm(output, { recursive: true, force: true }))).catch(() => {
  console.error('Could not clear generated API build output.');
  process.exitCode = 1;
});
