<script lang="ts">
	import { Stage, Layer, Rect, Path, Transformer } from 'svelte-konva';
	import type Konva from 'konva';
	import { store } from '$lib/state.svelte';
	import { buildMarkSet, computeMedia, markSetToPath, type MarkSet } from '$lib/marks';
	import LayerNode from './LayerNode.svelte';

	let zoom = $state(3);
	let transformer = $state<{ node: Konva.Transformer } | undefined>(undefined);
	const nodeMap = new Map<string, Konva.Group>();

	const marks = $derived.by<MarkSet>(() => buildMarkSet(store.doc));
	const media = $derived(computeMedia(store.doc, marks));

	const stageWidth = $derived(Math.max(1, media.widthMm * zoom));
	const stageHeight = $derived(Math.max(1, media.heightMm * zoom));
	const originX = $derived(media.trimX * zoom);
	const originY = $derived(media.trimY * zoom);
	const pageW = $derived(store.doc.page.width * zoom);
	const pageH = $derived(store.doc.page.height * zoom);
	const bleedPx = $derived(store.doc.bleed.enabled ? store.doc.bleed.amountMm * zoom : 0);
	const marksPath = $derived(marks.primitives.length ? markSetToPath(marks) : '');

	function registerNode(id: string, node: Konva.Group) {
		nodeMap.set(id, node);
		if (store.selectedId === id) syncTransformer(id);
	}

	function syncTransformer(id: string | null) {
		if (!transformer) return;
		const node = id ? nodeMap.get(id) : undefined;
		transformer.node.nodes(node ? [node] : []);
		transformer.node.getLayer()?.batchDraw();
	}

	$effect(() => {
		syncTransformer(store.selectedId);
	});

	function handleStagePointerDown(e: Konva.KonvaEventObject<PointerEvent>) {
		const stage = e.target.getStage();
		if (e.target === stage) store.selectedId = null;
	}
</script>

<div class="editor">
	<div class="toolbar">
		<button onclick={() => (zoom = Math.max(0.5, zoom - 0.5))} title="Zoom out">−</button>
		<span class="zoom">{zoom.toFixed(1)} px/mm</span>
		<button onclick={() => (zoom = Math.min(12, zoom + 0.5))} title="Zoom in">+</button>
		<span class="dims">{media.widthMm.toFixed(1)} × {media.heightMm.toFixed(1)} mm</span>
	</div>

	<div class="canvas-wrap">
		<Stage
			width={stageWidth}
			height={stageHeight}
			onpointerdown={handleStagePointerDown}
		>
			<Layer>
				<Rect x={0} y={0} width={stageWidth} height={stageHeight} fill="#e9ecf1" listening={false} />
				{#if store.doc.bleed.enabled}
					<Rect
						x={originX - bleedPx}
						y={originY - bleedPx}
						width={pageW + bleedPx * 2}
						height={pageH + bleedPx * 2}
						fill={store.doc.bleed.mode === 'solid' ? store.doc.bleed.solidColor : '#ffffff'}
						listening={false}
					/>
				{/if}
				<Rect
					x={originX}
					y={originY}
					width={pageW}
					height={pageH}
					fill={store.doc.background || '#ffffff'}
					stroke="#94a3b8"
					strokeWidth={1}
					dash={[6, 4]}
					listening={false}
				/>
				{#if marksPath}
					<Path
						data={marksPath}
						x={originX}
						y={originY}
						scaleX={zoom}
						scaleY={zoom}
						stroke="#111827"
						strokeWidth={store.doc.registration.lineWidthMm}
						fillEnabled={false}
						listening={false}
					/>
				{/if}
			</Layer>

			<Layer>
				{#each store.doc.layers as layer (layer.id)}
					<LayerNode
						{layer}
						{zoom}
						{originX}
						{originY}
						showCut={store.doc.showCutLine}
						onReady={(node) => registerNode(layer.id, node)}
						onSelect={(id) => (store.selectedId = id)}
					/>
				{/each}
			</Layer>

			<Layer>
				<Transformer
					bind:this={transformer}
					rotateEnabled={true}
					keepRatio={true}
					boundBoxFunc={(oldBox, newBox) => (newBox.width < 8 || newBox.height < 8 ? oldBox : newBox)}
				/>
			</Layer>
		</Stage>
	</div>
</div>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		min-width: 0;
		height: 100%;
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid var(--border);
		background: var(--panel);
	}
	.toolbar button {
		width: 1.9rem;
		height: 1.9rem;
		font-size: 1rem;
		line-height: 1;
	}
	.zoom,
	.dims {
		font-size: 0.8rem;
		color: var(--muted);
	}
	.dims {
		margin-left: auto;
	}
	.canvas-wrap {
		flex: 1;
		overflow: auto;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 1.5rem;
	}
</style>
