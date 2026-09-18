<script lang="ts">
	import { onMount } from 'svelte';
	import { store } from '$lib/state.svelte';
	import {
		saveProject,
		downloadProject,
		loadProject,
		openProject,
		deleteProject,
	} from '$lib/actions';
	import { savedProjectState, refreshSavedProjects } from '$lib/projectStorage.svelte';
	import { formatBytes } from '$lib/project';

	let root = $state<HTMLElement | undefined>(undefined);
	let fileInput = $state<HTMLInputElement | undefined>(undefined);
	let open = $state(false);
	let name = $state('');
	let busy = $state(false);
	let message = $state('');
	let error = $state('');

	onMount(() => {
		void refreshSavedProjects();
		name = store.doc.name;
	});

	$effect(() => {
		if (!open || !root) return;
		const onPointerDown = (event: PointerEvent) => {
			if (root && !root.contains(event.target as Node)) open = false;
		};
		window.addEventListener('pointerdown', onPointerDown);
		return () => window.removeEventListener('pointerdown', onPointerDown);
	});

	async function run(fn: () => Promise<string | void>, ok: string) {
		error = '';
		message = '';
		busy = true;
		try {
			const result = await fn();
			message = typeof result === 'string' ? result : ok;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	function onSave(useInput = true) {
		return run(async () => {
			const saved = await saveProject(useInput ? name : undefined);
			name = saved;
			return `Saved “${saved}” to this browser`;
		}, 'Saved');
	}

	function onLoad(savedName: string) {
		return run(async () => {
			await loadProject(savedName);
			name = store.doc.name;
			open = false;
			return `Loaded “${savedName}”`;
		}, 'Loaded');
	}

	async function onDelete(savedName: string) {
		if (!window.confirm(`Delete the saved project “${savedName}”?`)) return;
		error = '';
		message = '';
		busy = true;
		try {
			await deleteProject(savedName);
			message = `Deleted “${savedName}”`;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function onOpenFile(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		await run(async () => {
			await openProject(file);
			name = store.doc.name;
			open = false;
			return `Opened “${file.name}”`;
		}, 'Opened');
	}

	async function onDownload() {
		await run(async () => {
			await downloadProject();
			return 'Downloaded project file';
		}, 'Downloaded');
	}

	function onKeydown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
			event.preventDefault();
			void onSave(false);
		}
	}

	function savedLabel(savedAt: string): string {
		if (!savedAt) return 'unknown date';
		const date = new Date(savedAt);
		return Number.isNaN(date.getTime()) ? savedAt : date.toLocaleString();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="project" bind:this={root}>
	<button onclick={() => (open = !open)} disabled={busy} aria-expanded={open}>
		Project ▾
	</button>

	{#if open}
		<div class="menu">
			<label class="field">
				Project name
				<input
					type="text"
					bind:value={name}
					placeholder="Untitled"
					onkeydown={(e) => e.key === 'Enter' && onSave()}
				/>
			</label>

			<button class="wide" onclick={() => onSave()} disabled={busy}>
				Save to browser
			</button>

			<div class="row">
				<button onclick={onDownload} disabled={busy}>Download .json</button>
				<button onclick={() => fileInput?.click()} disabled={busy}>Open .json…</button>
			</div>
			<input
				bind:this={fileInput}
				type="file"
				accept=".json,application/json"
				hidden
				onchange={onOpenFile}
			/>

			<div class="saved">
				<h3>Saved projects</h3>
				{#if savedProjectState.projects.length === 0}
					<p class="hint">Nothing saved in this browser yet.</p>
				{:else}
					<ul>
						{#each savedProjectState.projects as saved (saved.name)}
							<li>
								<div class="info">
									<span class="saved-name">{saved.name}</span>
									<span class="meta"
										>{savedLabel(saved.savedAt)} · {formatBytes(saved.bytes)}</span
									>
								</div>
								<div class="actions">
									<button onclick={() => onLoad(saved.name)} disabled={busy}>Load</button>
									<button onclick={() => onDelete(saved.name)} disabled={busy} title="Delete">✕</button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			{#if error}
				<p class="hint error">{error}</p>
			{:else if message}
				<p class="hint ok">{message}</p>
			{:else}
				<p class="hint">Stored in this browser. Download a file to keep or move it.</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.project {
		position: relative;
	}
	.menu {
		position: absolute;
		top: calc(100% + 0.35rem);
		left: 0;
		z-index: 30;
		width: 20rem;
		max-height: 26rem;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 12px 30px rgba(15, 23, 42, 0.15);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.75rem;
		color: var(--muted);
	}
	.wide {
		width: 100%;
	}
	.row {
		display: flex;
		gap: 0.4rem;
	}
	.row button {
		flex: 1;
	}
	.saved {
		border-top: 1px solid var(--border);
		padding-top: 0.5rem;
	}
	h3 {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
		margin: 0 0 0.35rem;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-height: 12rem;
		overflow-y: auto;
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.saved-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.82rem;
	}
	.meta {
		font-size: 0.65rem;
		color: var(--muted);
	}
	.actions {
		display: flex;
		gap: 0.2rem;
	}
	.actions button {
		padding: 0.2rem 0.45rem;
		font-size: 0.75rem;
	}
	.hint {
		font-size: 0.7rem;
		color: var(--muted);
		margin: 0;
		line-height: 1.35;
	}
	.hint.error {
		color: #b91c1c;
	}
	.hint.ok {
		color: #15803d;
	}
</style>
