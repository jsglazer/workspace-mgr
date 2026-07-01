import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Core tests import only from src/core (and pure helpers); they never import
// the `obsidian` module. The few shell-boundary tests that do import obsidian
// alias it to a runtime stub (the published package is types-only) and further
// override members via vi.mock('obsidian').
export default defineConfig({
    resolve: {
        alias: {
            obsidian: fileURLToPath(new URL('./tests/stubs/obsidian.ts', import.meta.url)),
        },
    },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        globals: false,
    },
});
