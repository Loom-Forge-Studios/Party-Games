import { defineConfig } from 'vite';

// `build.outDir` is deliberately NOT "dist" — that's already `tsc -b`'s
// output directory for this package's compiled `.js`/`.d.ts` (see
// tsconfig.json's `outDir`, consumed by other workspace packages via
// package.json's `main`/`types`). A vite build producing the static site
// bundle into the same folder would clobber that on every `vite build`, so
// this uses a separate directory instead.
export default defineConfig({
  server: { port: 5173 },
  preview: { port: 4173 },
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
  },
});
