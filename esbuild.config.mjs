import esbuild from 'esbuild';
import process from 'process';
import builtins from 'builtin-modules';

const prod = process.argv[2] === 'production';

const banner = `/*
This is a bundled file. The source lives under src/. Do not edit directly.
Plugin: workspace-mgr (Workspace Manager). Derived from obsidian-workspace-plus (MIT).
*/`;

const context = await esbuild.context({
    banner: { js: banner },
    entryPoints: ['src/main.ts'],
    bundle: true,
    external: [
        'obsidian',
        'electron',
        '@codemirror/autocomplete',
        '@codemirror/collab',
        '@codemirror/commands',
        '@codemirror/language',
        '@codemirror/lint',
        '@codemirror/search',
        '@codemirror/state',
        '@codemirror/view',
        '@lezer/common',
        '@lezer/highlight',
        '@lezer/lr',
        ...builtins,
    ],
    format: 'cjs',
    target: 'es2018',
    logLevel: 'info',
    sourcemap: prod ? false : 'inline',
    treeShaking: true,
    outfile: 'main.js',
});

if (prod) {
    await context.rebuild();
    process.exit(0);
} else {
    await context.watch();
}
