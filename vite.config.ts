import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, lazyPlugins } from 'vite-plus';

export default defineConfig({
	fmt: {
		useTabs: true,
		singleQuote: true,
		trailingComma: 'all',
	},
	lint: {
		jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
		rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
		options: { typeAware: true, typeCheck: true },
	},
	plugins: lazyPlugins(() => [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
			},

			// Client-only SPA: everything is rendered in the browser.
			adapter: adapter({
				fallback: 'index.html',
			}),
		}),
	]),
	optimizeDeps: {
		// These ship large wasm/worker payloads; keep them out of the dep scanner.
		exclude: ['@imgly/background-removal', 'onnxruntime-web'],
	},
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}'],
		environment: 'node',
		server: {
			deps: {
				// potrace-ts ships extensionless ESM imports that Node cannot
				// resolve; let Vite inline and transform it for tests.
				inline: ['@cadit-app/potrace-ts'],
			},
		},
	},
});
