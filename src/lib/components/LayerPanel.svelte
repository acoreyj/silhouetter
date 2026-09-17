<script lang="ts">
	import { store } from '$lib/state.svelte';

	const layers = $derived([...store.doc.layers].reverse());

	function toggleVisible(id: string) {
		const layer = store.doc.layers.find((l) => l.id === id);
		if (layer) store.updateLayer(id, { visible: !layer.visible });
	}
</script>

<div class="panel">
	<h2>Layers</h2>
	{#if store.doc.layers.length === 0}
		<p class="empty">Import an image to begin.</p>
	{:else}
		<ul>
			{#each layers as layer (layer.id)}
				<li class:selected={store.selectedId === layer.id}>
					<button class="row" onclick={() => (store.selectedId = layer.id)}>
						<span class="name">{layer.name}</span>
						<span class="kind">{layer.kind}</span>
					</button>
					<div class="actions">
						<button
							title="Toggle visibility"
							onclick={() => toggleVisible(layer.id)}
							disabled={layer.locked}
						>
							{layer.visible ? '👁' : '🚫'}
						</button>
						<button title="Bring forward" onclick={() => store.bringForward(layer.id)}>↑</button>
						<button title="Send backward" onclick={() => store.sendBackward(layer.id)}>↓</button>
						<button title="Delete" onclick={() => store.removeLayer(layer.id)}>✕</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.panel {
		padding: 0.75rem;
	}
	h2 {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
		margin: 0 0 0.5rem;
	}
	.empty {
		font-size: 0.8rem;
		color: var(--muted);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		border-radius: 6px;
		border: 1px solid transparent;
	}
	li.selected {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		border-color: var(--accent);
	}
	.row {
		flex: 1;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.5rem;
		border: none;
		background: transparent;
		text-align: left;
		min-width: 0;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.kind {
		font-size: 0.65rem;
		color: var(--muted);
		text-transform: uppercase;
	}
	.actions {
		display: flex;
	}
	.actions button {
		border: none;
		background: transparent;
		padding: 0.25rem 0.35rem;
		font-size: 0.8rem;
	}
</style>
