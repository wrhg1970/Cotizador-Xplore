import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC emits the decorator metadata Nest's DI needs; esbuild does not.
export default defineConfig({ plugins: [swc.vite()], test: { fileParallelism: false } });
