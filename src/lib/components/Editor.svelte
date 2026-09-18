<script lang="ts">
	import { Stage, Layer, Rect, Path, Transformer, Line, Circle } from 'svelte-konva';
	import type Konva from 'konva';
	import { store, getSource, brush, maskPixelSize } from '$lib/state.svelte';
	import {
		addMaskStroke,
		magicEraseAt,
		computeMagicEraseRegion,
		sliceMask,
		type MagicEraseRegion,
	} from '$lib/actions';
	import { buildMarkSet, computeMedia, markSetToPath, type MarkSet } from '$lib/marks';
	import { buildTrimPolygons, polygonsBounds } from '$lib/geometry/shape';
	import { halfPlanePolygon, snapLine } from '$lib/geometry/slice';
	import { pagePointToLayerLocal, polygonsToMm, transformPolygonsToPage } from '$lib/geometry/transform';
	import { polygonsToSvgPath } from '$lib/vector/trace';
	import type { MaskLayer, MaskableLayer, Point, SubjectLayer } from '$lib/types';
	import { applyNodeOrder } from './layerOrder';
	import LayerNode from './LayerNode.svelte';
	import MaskNode from './MaskNode.svelte';

	let zoom = $state(3);
	let transformer = $state<{ node: Konva.Transformer } | undefined>(undefined);
	let stage = $state<{ node: Konva.Stage } | undefined>(undefined);
	let canvasLayer = $state<{ node: Konva.Layer } | undefined>(undefined);
	const nodeMap = new Map<string, Konva.Group>();
	const containerMap = new Map<string, Konva.Group>();
	let containerRevision = $state(0);

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
		if (!brush.active || brush.tool !== 'brush') return undefined;
		const selected = store.selected;
		if (!selected) return undefined;
		if (selected.kind === 'mask') return selected;
		if (selected.kind !== 'subject' || !selected.maskDataUrl) return undefined;
		if (!getSource(selected.sourceId)) return undefined;
		return selected;
	});

	// The magic eraser samples the source image's colours, so it only applies to
	// a traced (subject) layer.
	const magicLayer = $derived.by<SubjectLayer | undefined>(() => {
		if (!brush.active || brush.tool !== 'magic') return undefined;
		const selected = store.selected;
		if (!selected || selected.kind !== 'subject' || !selected.maskDataUrl) return undefined;
		if (!getSource(selected.sourceId)) return undefined;
		return selected;
	});

	// The slice tool cuts a straight edge into whichever subject or mask layer is
	// selected.
	const sliceLayer = $derived.by<MaskableLayer | undefined>(() => {
		if (!brush.active || brush.tool !== 'slice') return undefined;
		const selected = store.selected;
		if (!selected) return undefined;
		if (selected.kind === 'mask') return selected;
		if (selected.kind !== 'subject' || !selected.maskDataUrl) return undefined;
		if (!getSource(selected.sourceId)) return undefined;
		return selected;
	});

	function registerNode(id: string, node: Konva.Group) {
		if (nodeMap.get(id) === node) return;
		nodeMap.set(id, node);
		if (store.selectedId === id) syncTransformer(id);
	}

	function registerContainer(id: string, node: Konva.Group) {
		// Registering the same node again (the container effect can re-run when
		// props change identity) must not bump the revision, or the reorder effect
		// below re-renders the parent and re-triggers the effect in a loop.
		if (containerMap.get(id) === node) return;
		containerMap.set(id, node);
		containerRevision++;
	}

	// `svelte-konva` appends each layer's node to the Konva layer once, at mount;
	// reordering the `{#each}` (bring forward / send backward) moves the Svelte
	// components but not the underlying nodes. Re-apply the document order to the
	// Konva children so the canvas matches the layer panel. Mask punch overlays
	// are not layer containers and are kept on top.
	$effect(() => {
		void containerRevision;
		const konvaLayer = canvasLayer?.node;
		if (!konvaLayer) return;
		const containers = new Set<Konva.Group>(containerMap.values());
		const ordered = store.doc.layers
			.map((l) => containerMap.get(l.id))
			.filter((node): node is Konva.Group => !!node);
		applyNodeOrder(konvaLayer, ordered, (node) => containers.has(node as Konva.Group));
		konvaLayer.batchDraw();
	});

	function syncTransformer(id: string | null) {
		if (!transformer) return;
		const node = id ? nodeMap.get(id) : undefined;
		transformer.node.nodes(node ? [node] : []);
		transformer.node.getLayer()?.batchDraw();
	}

	$effect(() => {
		if (!transformer) return;
		if (brushLayer || sliceLayer) {
			transformer.node.nodes([]);
			transformer.node.getLayer()?.batchDraw();
			return;
		}
		syncTransformer(store.selectedId);
	});

	function handleStagePointerDown(e: Konva.KonvaEventObject<PointerEvent>) {
		const targetStage = e.target.getStage();
		if (e.target !== targetStage) return;
		if (store.autoSelect) {
			store.selectedId = null;
			return;
		}
		// Auto-select off: keep the selection and drag it from anywhere.
		const id = store.selectedId;
		const node = id ? nodeMap.get(id) : undefined;
		const layer = id ? store.doc.layers.find((l) => l.id === id) : undefined;
		if (node && layer && !layer.locked) node.startDrag({ evt: e.evt });
	}

	// --- Brush painting -----------------------------------------------------

	let painting = $state(false);
	let livePoints = $state<Point[]>([]);
	let cursor = $state<Point | null>(null);

	// Straight-slice drag: start and current end of the cut line, in stage px.
	let slicing = $state(false);
	let sliceStart = $state<Point | null>(null);
	let sliceEnd = $state<Point | null>(null);

	// Magic-eraser hover preview: the region that would be erased on click.
	let magicPreview = $state<MagicEraseRegion | null>(null);
	let magicPreviewKey = '';
	let previewRequest = 0;
	let previewTimer: ReturnType<typeof setTimeout> | undefined;

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

	function clearMagicPreview() {
		if (previewTimer) clearTimeout(previewTimer);
		previewTimer = undefined;
		previewRequest++;
		magicPreviewKey = '';
		magicPreview = null;
	}

	/** Debounced preview so hovering shows the region before the user clicks. */
	function scheduleMagicPreview(stageP: Point) {
		const layer = magicLayer;
		if (!layer) return;
		if (previewTimer) clearTimeout(previewTimer);
		previewTimer = setTimeout(() => void updateMagicPreview(layer, stageP), 120);
	}

	async function updateMagicPreview(layer: SubjectLayer, stageP: Point) {
		const size = maskPixelSize(layer);
		if (!size.width || !size.height) return;
		const point = toSourcePoint(stageP, layer, size.width, size.height);
		const key = `${layer.id}:${Math.round(point.x)}:${Math.round(point.y)}:${brush.tolerance}`;
		if (key === magicPreviewKey) return;
		magicPreviewKey = key;
		const request = ++previewRequest;
		const region = await computeMagicEraseRegion(layer.id, point, brush.tolerance).catch(
			() => undefined,
		);
		if (request !== previewRequest) return;
		magicPreview = region ?? null;
	}

	// Reset the preview whenever the tool, target or tolerance changes.
	$effect(() => {
		void brush.active;
		void brush.tool;
		void brush.tolerance;
		void magicLayer?.id;
		clearMagicPreview();
	});

	function onStagePointerDown(e: Konva.KonvaEventObject<PointerEvent>) {
		if (brush.active && brush.tool === 'magic') {
			const magician = magicLayer;
			if (magician) {
				e.evt.preventDefault();
				void applyMagicErase(magician, e.evt);
				return;
			}
		}
		if (brush.active && brush.tool === 'slice') {
			const slicer = sliceLayer;
			if (slicer) {
				e.evt.preventDefault();
				slicing = true;
				const p = stagePoint(e.evt);
				sliceStart = p;
				sliceEnd = p;
				window.addEventListener('pointermove', onSlicePointerMove);
				window.addEventListener('pointerup', onSlicePointerUp);
				return;
			}
		}
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

	/** Flood-fill the colour under the cursor and erase it from the layer mask. */
	async function applyMagicErase(layer: SubjectLayer, ev: PointerEvent) {
		const size = maskPixelSize(layer);
		if (!size.width || !size.height) return;
		const point = toSourcePoint(stagePoint(ev), layer, size.width, size.height);
		clearMagicPreview();
		await magicEraseAt(layer.id, point, brush.tolerance).catch(() => {});
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

	function onSlicePointerMove(ev: PointerEvent) {
		if (!slicing || !sliceStart) return;
		const p = stagePoint(ev);
		sliceEnd = ev.shiftKey ? snapLine(sliceStart, p) : p;
	}

	async function onSlicePointerUp() {
		window.removeEventListener('pointermove', onSlicePointerMove);
		window.removeEventListener('pointerup', onSlicePointerUp);
		const layer = sliceLayer;
		const start = sliceStart;
		const end = sliceEnd;
		slicing = false;
		sliceStart = null;
		sliceEnd = null;
		if (!layer || !start || !end) return;
		const size = maskPixelSize(layer);
		if (!size.width || !size.height) return;
		const p0 = toSourcePoint(start, layer, size.width, size.height);
		const p1 = toSourcePoint(end, layer, size.width, size.height);
		if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1) return;
		await sliceMask(layer.id, p0, p1, brush.sliceSide, brush.mode).catch(() => {});
	}

	function onStagePointerMove(e: Konva.KonvaEventObject<PointerEvent>) {
		if (!brushLayer && !magicLayer && !painting) return;
		const p = stagePoint(e.evt);
		cursor = p;
		if (magicLayer && !painting) scheduleMagicPreview(p);
	}

	const liveStrokePoints = $derived(livePoints.flatMap((p) => [p.x, p.y]));
	const brushColor = $derived(brush.mode === 'erase' ? '#ef4444' : '#2563eb');

	// Region the magic eraser would remove, drawn in stage space for the preview.
	const magicPreviewPath = $derived.by(() => {
		const layer = magicLayer;
		const preview = magicPreview;
		if (!layer || !preview || preview.polygons.length === 0) return '';
		const size = maskPixelSize(layer);
		if (!size.width || !size.height) return '';
		const mm = polygonsToMm(preview.polygons, size.width, size.height, layer);
		const page = transformPolygonsToPage(mm, layer);
		return polygonsToSvgPath(page, 2, (p) => toStage(p));
	});

	const magicPreviewPercent = $derived(
		magicPreview && magicPreview.total > 0
			? Math.round((magicPreview.count / magicPreview.total) * 100)
			: 0,
	);

	// Region the slice would remove, drawn in stage space while dragging.
	const sliceLinePoints = $derived(
		sliceStart && sliceEnd
			? [sliceStart.x, sliceStart.y, sliceEnd.x, sliceEnd.y]
			: [],
	);
	const slicePreviewPath = $derived.by(() => {
		const layer = sliceLayer;
		const start = sliceStart;
		const end = sliceEnd;
		if (!layer || !start || !end) return '';
		const size = maskPixelSize(layer);
		if (!size.width || !size.height) return '';
		const p0 = toSourcePoint(start, layer, size.width, size.height);
		const p1 = toSourcePoint(end, layer, size.width, size.height);
		const quad = halfPlanePolygon(p0, p1, brush.sliceSide, size);
		if (quad.length === 0) return '';
		const mm = polygonsToMm([quad], size.width, size.height, layer);
		const page = transformPolygonsToPage(mm, layer);
		return polygonsToSvgPath(page, 2, (p) => toStage(p));
	});
</script>

<div class="editor">
	<div class="toolbar">
		<button onclick={() => (zoom = Math.max(0.5, zoom - 0.5))} title="Zoom out">−</button>
		<span class="zoom">{zoom.toFixed(1)} px/mm</span>
		<button onclick={() => (zoom = Math.min(12, zoom + 0.5))} title="Zoom in">+</button>
		<label class="toggle" title="Click the topmost layer under the cursor to select it">
			<input type="checkbox" bind:checked={store.autoSelect} />
			Auto-select
		</label>
		{#if brush.active}
			<span class="brush-hint">
				{#if brush.tool === 'magic'}
					{#if !magicLayer}
						Select a traced layer to magic-erase
					{:else if magicPreview}
						Magic eraser: {magicPreviewPercent}% of subject selected — click to erase
					{:else}
						Magic eraser: hover to preview, click to erase
					{/if}
				{:else if brush.tool === 'slice'}
					{sliceLayer
						? `Slice: drag a line to ${brush.mode === 'erase' ? 'cut away' : 'add back'} one side (hold Shift to level)`
						: 'Select a subject or mask layer to slice'}
				{:else}
					{brushLayer ? `Painting: ${brush.mode}` : 'Select a subject or mask layer to paint'}
				{/if}
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
			onpointerleave={() => {
				cursor = null;
				clearMagicPreview();
			}}
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

			<Layer bind:this={canvasLayer}>
				{#each store.doc.layers as layer (layer.id)}
					<LayerNode
						{layer}
						{zoom}
						{originX}
						{originY}
						showCut={store.doc.showCutLine}
						interactive={!brush.active}
						onReady={(node) => registerNode(layer.id, node)}
						onContainer={(node) => registerContainer(layer.id, node)}
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

			{#if brushLayer || magicLayer || sliceLayer}
				<Layer listening={false}>
					{#if slicePreviewPath}
						<Path
							data={slicePreviewPath}
							fill="rgba(239, 68, 68, 0.35)"
							listening={false}
						/>
					{/if}
					{#if sliceLinePoints.length === 4}
						<Line
							points={sliceLinePoints}
							stroke="#ef4444"
							strokeWidth={1.5}
							dash={[8, 4]}
							listening={false}
						/>
					{/if}
					{#if magicPreviewPath}
						<Path
							data={magicPreviewPath}
							fill="rgba(239, 68, 68, 0.4)"
							stroke="#ef4444"
							strokeWidth={1}
							listening={false}
						/>
					{/if}
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
						{#if brush.tool === 'magic'}
							<Circle
								x={cursor.x}
								y={cursor.y}
								radius={6}
								stroke="#ef4444"
								strokeWidth={1.5}
								fillEnabled={false}
								listening={false}
							/>
							<Line
								points={[cursor.x - 10, cursor.y, cursor.x + 10, cursor.y]}
								stroke="#ef4444"
								strokeWidth={1}
								listening={false}
							/>
							<Line
								points={[cursor.x, cursor.y - 10, cursor.x, cursor.y + 10]}
								stroke="#ef4444"
								strokeWidth={1}
								listening={false}
							/>
						{:else}
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
	.toggle {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.8rem;
		color: var(--muted);
		user-select: none;
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
