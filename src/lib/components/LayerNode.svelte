<script lang="ts">
	import { Group, Image as KonvaImage, Path } from 'svelte-konva';
	import type Konva from 'konva';
	import type { Layer as DocLayer } from '$lib/types';
	import { store, getSource, loadMask } from '$lib/state.svelte';
	import { composeMasked, type Canvas2D } from '$lib/image/ops';
	import { polygonsToSvgPath } from '$lib/vector/trace';
	import { buildCutPolygons } from '$lib/export/cut';

	let {
		layer,
		zoom,
		originX,
		originY,
		showCut = true,
		onReady,
		onSelect
	}: {
		layer: DocLayer;
		zoom: number;
		originX: number;
		originY: number;
		showCut?: boolean;
		onReady?: (node: Konva.Group) => void;
		onSelect?: (id: string) => void;
	} = $props();

	let group = $state<{ node: Konva.Group } | undefined>(undefined);
	let maskedEl = $state<Canvas2D | undefined>(undefined);

	const sourceEl = $derived(getSource(layer.sourceId));
	const displayEl = $derived(maskedEl ?? sourceEl);

	$effect(() => {
		const dataUrl = layer.kind === 'subject' ? layer.maskDataUrl : null;
		if (dataUrl && sourceEl) {
			const key = `${layer.id}:${sourceEl.src}:${dataUrl}`;
			loadMask(layer.id, dataUrl).then((mask) => {
				maskedEl = composeMasked(key, sourceEl, mask);
			});
		} else {
			maskedEl = undefined;
		}
	});

	$effect(() => {
		if (group?.node && onReady) onReady(group.node);
	});

	const cx = $derived((layer.x + layer.width / 2) * zoom + originX);
	const cy = $derived((layer.y + layer.height / 2) * zoom + originY);
	const w = $derived(Math.max(1, layer.width * zoom));
	const h = $derived(Math.max(1, layer.height * zoom));

	const cutPath = $derived.by(() => {
		if (!showCut) return '';
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
	draggable={!layer.locked}
	onpointerdown={() => onSelect?.(layer.id)}
	ondragend={() => group?.node && commitTransform(group.node)}
	ontransformend={() => group?.node && commitTransform(group.node)}
>
	{#if displayEl}
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
