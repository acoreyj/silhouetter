<script lang="ts">
	import { Image as KonvaImage } from 'svelte-konva';
	import type { MaskLayer } from '$lib/types';
	import { store, getMask, getMaskRevision, maskRevision } from '$lib/state.svelte';

	let {
		layer,
		zoom,
		originX,
		originY
	}: {
		layer: MaskLayer;
		zoom: number;
		originX: number;
		originY: number;
	} = $props();

	// Page-coloured punch overlay, rebuilt whenever the mask changes. Building it
	// synchronously in a derivation keeps it in step with the reactive strokes.
	const canvas = $derived.by<HTMLCanvasElement | undefined>(() => {
		void `${layer.maskStrokes.length}:${layer.maskStrokes.reduce((n, s) => n + s.points.length, 0)}`;
		void getMaskRevision(layer.id);
		void maskRevision.value;
		const hole = getMask(layer.id);
		if (!hole || !layer.visible) return undefined;
		const c = document.createElement('canvas');
		c.width = hole.naturalWidth;
		c.height = hole.naturalHeight;
		const ctx = c.getContext('2d');
		if (!ctx) return undefined;
		ctx.drawImage(hole, 0, 0);
		ctx.globalCompositeOperation = 'source-in';
		ctx.fillStyle = store.doc.background || '#ffffff';
		ctx.fillRect(0, 0, c.width, c.height);
		return c;
	});

	const cx = $derived((layer.x + layer.width / 2) * zoom + originX);
	const cy = $derived((layer.y + layer.height / 2) * zoom + originY);
	const w = $derived(Math.max(1, layer.width * zoom));
	const h = $derived(Math.max(1, layer.height * zoom));
</script>

{#if layer.visible && canvas}
	<KonvaImage
		image={canvas}
		x={cx}
		y={cy}
		offsetX={w / 2}
		offsetY={h / 2}
		width={w}
		height={h}
		rotation={layer.rotation}
		listening={false}
	/>
{/if}
