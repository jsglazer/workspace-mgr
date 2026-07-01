import { defineConfig } from 'vitest/config';

// Core tests import only from src/core (and pure helpers); they never import
// the `obsidian` module, so the whole suite runs headless under Node.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        globals: false,
    },
});
