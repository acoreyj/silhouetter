<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Silhouetter</title>
</svelte:head>

{@render children()}

<style>
	:global(:root) {
		--bg: #f8fafc;
		--panel: #ffffff;
		--fg: #0f172a;
		--muted: #64748b;
		--border: #e2e8f0;
		--accent: #4f46e5;
		font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		color-scheme: light;
	}
	:global(*, *::before, *::after) {
		box-sizing: border-box;
	}
	:global(html, body) {
		margin: 0;
		height: 100%;
		background: var(--bg);
		color: var(--fg);
	}
	:global(button) {
		font: inherit;
		border: 1px solid var(--border);
		background: var(--panel);
		color: var(--fg);
		border-radius: 6px;
		padding: 0.35rem 0.7rem;
		cursor: pointer;
	}
	:global(button:hover:not(:disabled)) {
		border-color: var(--accent);
	}
	:global(button:disabled) {
		opacity: 0.45;
		cursor: not-allowed;
	}
	:global(input[type='text']),
	:global(input[type='number']),
	:global(select) {
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.3rem 0.45rem;
		background: var(--panel);
		width: 100%;
	}
	:global(input[type='range']) {
		width: 100%;
	}
	:global(input[type='color']) {
		width: 100%;
		height: 1.9rem;
		padding: 0.1rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--panel);
	}
</style>
