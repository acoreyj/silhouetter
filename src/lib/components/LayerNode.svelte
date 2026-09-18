<script lang="ts">
	import { Group, Image as KonvaImage, Path, Rect } from 'svelte-konva';
	import type Konva from 'konva';
	import type { Layer as DocLayer } from '$lib/types';
	import { store, getSource, applyMaskStrokes, getMaskRevision } from '$lib/state.svelte';
	import { composeMasked, type Canvas2D } from '$lib/image/ops';
	import { polygonsToSvgPath } from '$lib/vector/trace';
	import { buildCutPolygons } from '$lib/export/cut';

	let {
		layer,
		zoom,
		originX,
		originY,
		showCut = true,
		interactive = true,
		onReady,
		onSelect
	}: {
		layer: DocLayer;
		zoom: number;
		originX: number;
		originY: number;
		showCut?: boolean;
		/** When false the layer cannot be dragged (e.g. while mask painting). */
		interactive?: boolean;
		onReady?: (node: Konva.Group) => void;
		onSelect?: (id: string) => void;
	} = $props();

	let group = $state<{ node: Konva.Group } | undefined>(undefined);
	let maskedEl = $state<Canvas2D | undefined>(undefined);

	const isMask = $derived(layer.kind === 'mask');
	const sourceEl = $derived(layer.kind === 'mask' ? undefined : getSource(layer.sourceId));
	const displayEl = $derived(maskedEl ?? sourceEl);

	let maskRequest = 0;

	$effect(() => {
		const subject = layer.kind === 'subject' ? layer : undefined;
		// Reading the strokes keeps the effect in sync with brush edits.
		const strokeSignature = subject
			? `${subject.maskStrokes.length}:${subject.maskStrokes.reduce((n, s) => n + s.points.length, 0)}`
			: '0:0';
		const dataUrl = subject?.maskDataUrl ?? null;
		const source = sourceEl;

		if (!dataUrl || !subject || !source) {
			maskedEl = undefined;
			return;
		}

		const request = ++maskRequest;
		void strokeSignature;
		applyMaskStrokes(subject).then((mask) => {
			if (!mask || request !== maskRequest) return;
			const key = `${layer.id}:${source.src}:${getMaskRevision(layer.id)}`;
			maskedEl = composeMasked(key, source, mask);
		});
	});

	$effect(() => {
		if (group?.node && onReady) onReady(group.node);
	});

	const cx = $derived((layer.x + layer.width / 2) * zoom + originX);
	const cy = $derived((layer.y + layer.height / 2) * zoom + originY);
	const w = $derived(Math.max(1, layer.width * zoom));
	const h = $derived(Math.max(1, layer.height * zoom));

	const cutPath = $derived.by(() => {
		if (isMask || !showCut) return '';
		// In bookmark mode the document silhouette is the cut line.
		if (store.doc.trimShape === 'bookmark') return '';
		if (layer.kind !== 'subject' || layer.cutPolygons.length === 0) return '';
		if (!sourceEl) return '';
		const page = buildCutPolygons(layer, sourceEl);
		return polygonsToSvgPath(page, 2, (p) => ({
			x: p.x * zoom + originX,
			y: p.y * zoom + originY
		}));
	});

	function commitTransform(node: Konva.Group) {
		const scaleX = node.scaleX();
		const scaleY = node.scaleY();
		node.scaleX(1);
		node.scaleY(1);
		const width = Math.max(1, layer.width * scaleX);
		const height = Math.max(1, layer.height * scaleY);
		const centerX = (node.x() - originX) / zoom;
		const centerY = (node.y() - originY) / zoom;
		store.updateLayer(layer.id, {
			x: centerX - width / 2,
			y: centerY - height / 2,
			width,
			height,
			rotation: node.rotation()
		});
	}
</script>

<Group
	bind:this={group}
	x={cx}
	y={cy}
	rotation={layer.rotation}
	opacity={layer.opacity}
	visible={layer.visible}
	draggable={!layer.locked && interactive}
	onpointerdown={() => onSelect?.(layer.id)}
	ondragend={() => group?.node && commitTransform(group.node)}
	ontransformend={() => group?.node && commitTransform(group.node)}
>
	{#if isMask}
		<Rect
			x={-w / 2}
			y={-h / 2}
			width={w}
			height={h}
			fill="rgba(15, 23, 42, 0.001)"
			stroke={store.selectedId === layer.id ? '#ff00aa' : undefined}
			strokeWidth={1}
			dash={[6, 4]}
			listening={interactive}
		/>
	{:else if displayEl}
		<KonvaImage image={displayEl} x={-w / 2} y={-h / 2} width={w} height={h} />
	{/if}
</Group>

{#if cutPath}
	<Path
		data={cutPath}
		stroke={store.doc.cutLineColor}
		strokeWidth={1}
		dash={[6, 4]}
		fillEnabled={false}
		listening={false}
	/>
{/if}
