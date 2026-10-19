/// <reference types="node" />
import { fileURLToPath } from 'node:url';

// Pure navigation engine tests: routing geometry, maneuvers, session state and voice scheduling.
export default {
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['tests/navigation/**/*.test.ts'], environment: 'node' },
};
