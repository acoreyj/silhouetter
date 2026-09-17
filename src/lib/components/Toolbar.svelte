<script lang="ts">
	import { store } from '$lib/state.svelte';
	import {
		importImage,
		segmentLayer,
		downloadPdf,
		downloadSvg,
		downloadPng
	} from '$lib/actions';

	let fileInput = $state<HTMLInputElement | undefined>(undefined);
	let busy = $state(false);
	let status = $state('');
	let error = $state('');

	async function onFiles(event: Event) {
		const input = event.target as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		if (!files.length) return;
		error = '';
		busy = true;
		try {
			for (const file of files) {
				await importImage(file);
				status = `Imported ${file.name}`;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function onSegment() {
		const id = store.selectedId;
		if (!id) {
			error = 'Select a layer to trace.';
			return;
		}
		error = '';
		busy = true;
		status = 'Removing background…';
		try {
			await segmentLayer(id, (key, current, total) => {
				const pct = total ? Math.round((current / total) * 100) : 0;
				status = `${key} ${pct}%`;
			});
			status = 'Outline traced';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function run(fn: () => Promise<void> | void, label: string) {
		error = '';
		busy = true;
		try {
			await fn();
			status = label;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

<div class="toolbar">
	<div class="brand">Silhouetter</div>

	<button onclick={() => fileInput?.click()} disabled={busy}>Import image</button>
	<input
		bind:this={fileInput}
		type="file"
		accept="image/png,image/jpeg,image/webp,image/*"
		multiple
		hidden
		onchange={onFiles}
	/>

	<button onclick={onSegment} disabled={busy || !store.selectedId}>Remove background</button>

	<div class="spacer"></div>

	<button onclick={() => store.undo()} disabled={!store.canUndo}>Undo</button>
	<button onclick={() => store.redo()} disabled={!store.canRedo}>Redo</button>

	<span class="divider"></span>

	<button onclick={() => run(() => downloadPdf(), 'PDF exported')} disabled={busy}>PDF</button>
	<button onclick={() => run(() => downloadSvg(), 'SVG exported')} disabled={busy}>SVG</button>
	<button onclick={() => run(() => downloadPng(), 'PNG exported')} disabled={busy}>PNG</button>
</div>

{#if busy || status || error}
	<div class="status" class:error>
		{#if busy}<span class="spinner"></span>{/if}
		{error || status}
	</div>
{/if}

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--border);
		background: var(--panel);
		flex-wrap: wrap;
	}
	.brand {
		font-weight: 700;
		letter-spacing: -0.02em;
		margin-right: 0.5rem;
	}
	.spacer {
		flex: 1;
	}
	.divider {
		width: 1px;
		height: 1.4rem;
		background: var(--border);
	}
	.status {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.75rem;
		font-size: 0.8rem;
		color: var(--muted);
		border-bottom: 1px solid var(--border);
	}
	.status.error {
		color: #b91c1c;
		background: #fef2f2;
	}
	.spinner {
		width: 0.8rem;
		height: 0.8rem;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
