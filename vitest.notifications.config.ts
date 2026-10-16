/// <reference types="node" />
import { fileURLToPath } from 'node:url';

// Frontend-only tests: never load the backend config, environment, or database setup.
export default {
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['tests/notifications.test.tsx'], environment: 'node' },
};
