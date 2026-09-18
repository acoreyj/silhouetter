<script lang="ts">
	import { Stage, Layer, Rect, Path, Transformer, Line, Circle } from 'svelte-konva';
	import type Konva from 'konva';
	import { store, getSource, brush, maskPixelSize } from '$lib/state.svelte';
	import { addMaskStroke } from '$lib/actions';
	import { buildMarkSet, computeMedia, markSetToPath, type MarkSet } from '$lib/marks';
	import { buildTrimPolygons, polygonsBounds } from '$lib/geometry/shape';
	import { pagePointToLayerLocal } from '$lib/geometry/transform';
	import { polygonsToSvgPath } from '$lib/vector/trace';
	import type { MaskLayer, MaskableLayer, Point } from '$lib/types';
	import LayerNode from './LayerNode.svelte';
	import MaskNode from './MaskNode.svelte';

	let zoom = $state(3);
	let transformer = $state<{ node: Konva.Transformer } | undefined>(undefined);
	let stage = $state<{ node: Konva.Stage } | undefined>(undefined);
	const nodeMap = new Map<string, Konva.Group>();

	const marks = $derived.by<MarkSet>(() => buildMarkSet(store.doc));
	const trimPolygons = $derived.by(() => buildTrimPolygons(store.doc, getSource));
	// The trim outline may overflow the page (bookmark head); let the media grow
	// so the head is not clipped off the canvas.
	const contentBounds = $derived(
		store.doc.trimShape === 'rect'
			? undefined
			: (polygonsBounds(trimPolygons) ?? undefined),
	);
	const media = $derived(computeMedia(store.doc, marks, contentBounds));

	const stageWidth = $derived(Math.max(1, media.widthMm * zoom));
	const stageHeight = $derived(Math.max(1, media.heightMm * zoom));
	const originX = $derived(media.trimX * zoom);
	const originY = $derived(media.trimY * zoom);
	const pageW = $derived(store.doc.page.width * zoom);
	const pageH = $derived(store.doc.page.height * zoom);
	const bleedPx = $derived(store.doc.bleed.enabled ? store.doc.bleed.amountMm * zoom : 0);
	const marksPath = $derived(marks.primitives.length ? markSetToPath(marks) : '');

	/** Page-millimetre point → stage pixels. */
	function toStage(p: Point): Point {
		return { x: p.x * zoom + originX, y: p.y * zoom + originY };
	}

	const isBookmark = $derived(store.doc.trimShape === 'bookmark');
	const trimOutlinePath = $derived(
		isBookmark
			? polygonsToSvgPath(trimPolygons, 2, (p) => toStage(p))
			: '',
	);
	// A panel-coloured shape with a hole punched where the bookmark is, so
	// artwork outside the silhouette is hidden in the preview.
	const outsideMaskPath = $derived.by(() => {
		if (!isBookmark) return '';
		const outer: Point[] = [
			{ x: 0, y: 0 },
			{ x: stageWidth, y: 0 },
			{ x: stageWidth, y: stageHeight },
			{ x: 0, y: stageHeight },
		];
		const rings = [outer, ...trimPolygons.map((r) => r.map((p) => toStage(p)))];
		return polygonsToSvgPath(rings, 2);
	});

	const maskLayers = $derived(
		store.doc.layers.filter((l): l is MaskLayer => l.kind === 'mask'),
	);

	const brushLayer = $derived.by<MaskableLayer | undefined>(() => {
		if (!brush.active) return undefined;
		const selected = store.selected;
		if (!selected) return undefined;
		if (selected.kind === 'mask') return selected;
		if (selected.kind !== 'subject' || !selected.maskDataUrl) return undefined;
		if (!getSource(selected.sourceId)) return undefined;
		return selected;
	});

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
		if (!transformer) return;
		if (brushLayer) {
			transformer.node.nodes([]);
			transformer.node.getLayer()?.batchDraw();
			return;
		}
		syncTransformer(store.selectedId);
	});

	function handleStagePointerDown(e: Konva.KonvaEventObject<PointerEvent>) {
		const targetStage = e.target.getStage();
		if (e.target === targetStage) store.selectedId = null;
	}

	// --- Brush painting -----------------------------------------------------

	let painting = $state(false);
	let livePoints = $state<Point[]>([]);
	let cursor = $state<Point | null>(null);

	function stagePoint(ev: PointerEvent): Point {
		const rect = stage?.node?.content.getBoundingClientRect();
		if (!rect) return { x: 0, y: 0 };
		return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
	}

	/** Map a stage-pixel point to the layer's mask pixel space. */
	function toSourcePoint(p: Point, layer: MaskableLayer, pixelW: number, pixelH: number): Point {
		const page = { x: (p.x - originX) / zoom, y: (p.y - originY) / zoom };
		const local = pagePointToLayerLocal(page, layer);
		return {
			x: (local.x * pixelW) / layer.width,
			y: (local.y * pixelH) / layer.height,
		};
	}

	function onStagePointerDown(e: Konva.KonvaEventObject<PointerEvent>) {
		const layer = brushLayer;
		if (!layer) {
			handleStagePointerDown(e);
			return;
		}
		e.evt.preventDefault();
		painting = true;
		const p = stagePoint(e.evt);
		livePoints = [p];
		cursor = p;
		window.addEventListener('pointermove', onWindowPointerMove);
		window.addEventListener('pointerup', onWindowPointerUp);
	}

	function onWindowPointerMove(ev: PointerEvent) {
		if (!painting) return;
		const p = stagePoint(ev);
		cursor = p;
		const last = livePoints[livePoints.length - 1];
		if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1.5) {
			livePoints = [...livePoints, p];
		}
	}

	async function onWindowPointerUp() {
		window.removeEventListener('pointermove', onWindowPointerMove);
		window.removeEventListener('pointerup', onWindowPointerUp);
		const layer = brushLayer;
		const points = livePoints;
		painting = false;
		livePoints = [];
		if (!layer || points.length === 0) return;
		const size = maskPixelSize(layer);
		if (!size.width || !size.height) return;
		const radiusPx = Math.max(1, (brush.radiusMm * size.width) / layer.width);
		const sourcePoints = points.map((p) =>
			toSourcePoint(p, layer, size.width, size.height),
		);
		await addMaskStroke(layer.id, { mode: brush.mode, radiusPx, points: sourcePoints });
	}

	function onStagePointerMove(e: Konva.KonvaEventObject<PointerEvent>) {
		if (!brushLayer && !painting) return;
		cursor = stagePoint(e.evt);
	}

	const liveStrokePoints = $derived(livePoints.flatMap((p) => [p.x, p.y]));
	const brushColor = $derived(brush.mode === 'erase' ? '#ef4444' : '#2563eb');
</script>

<div class="editor">
	<div class="toolbar">
		<button onclick={() => (zoom = Math.max(0.5, zoom - 0.5))} title="Zoom out">−</button>
		<span class="zoom">{zoom.toFixed(1)} px/mm</span>
		<button onclick={() => (zoom = Math.min(12, zoom + 0.5))} title="Zoom in">+</button>
		{#if brush.active}
			<span class="brush-hint">
				{brushLayer ? `Painting: ${brush.mode}` : 'Select a subject or mask layer to paint'}
			</span>
		{/if}
		<span class="dims">{media.widthMm.toFixed(1)} × {media.heightMm.toFixed(1)} mm</span>
	</div>

	<div class="canvas-wrap">
		<Stage
			bind:this={stage}
			width={stageWidth}
			height={stageHeight}
			onpointerdown={onStagePointerDown}
			onpointermove={onStagePointerMove}
			onpointerleave={() => (cursor = null)}
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
						interactive={!brush.active}
						onReady={(node) => registerNode(layer.id, node)}
						onSelect={(id) => (store.selectedId = id)}
					/>
				{/each}
				{#each maskLayers as layer (layer.id)}
					<MaskNode {layer} {zoom} {originX} {originY} />
				{/each}
			</Layer>

			{#if isBookmark}
				<Layer listening={false}>
					<Path
						data={outsideMaskPath}
						fill="#e9ecf1"
						fillRule="evenodd"
						listening={false}
					/>
					{#if store.doc.showCutLine}
						<Path
							data={trimOutlinePath}
							stroke={store.doc.cutLineColor}
							strokeWidth={1}
							dash={[6, 4]}
							fillEnabled={false}
							listening={false}
						/>
					{/if}
				</Layer>
			{/if}

			{#if brushLayer}
				<Layer listening={false}>
					{#if livePoints.length > 1}
						<Line
							points={liveStrokePoints}
							stroke={brushColor}
							strokeWidth={Math.max(1, brush.radiusMm * 2 * zoom)}
							lineCap="round"
							lineJoin="round"
							opacity={0.45}
							listening={false}
						/>
					{:else if livePoints.length === 1}
						<Circle
							x={livePoints[0].x}
							y={livePoints[0].y}
							radius={Math.max(1, brush.radiusMm * zoom)}
							fill={brushColor}
							opacity={0.45}
							listening={false}
						/>
					{/if}
					{#if cursor}
						<Circle
							x={cursor.x}
							y={cursor.y}
							radius={Math.max(1, brush.radiusMm * zoom)}
							stroke={brushColor}
							strokeWidth={1.5}
							fillEnabled={false}
							listening={false}
						/>
					{/if}
				</Layer>
			{/if}

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
	.dims,
	.brush-hint {
		font-size: 0.8rem;
		color: var(--muted);
	}
	.brush-hint {
		color: var(--accent);
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
