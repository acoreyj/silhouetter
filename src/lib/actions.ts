import { store, getSource, getMask, loadSource, loadMask } from './state.svelte';
import { newId } from './doc.svelte';
import type { ImageLayer, Layer, SubjectLayer } from './types';
import {
	createCanvas,
	get2d,
	probeImage,
	renderArtwork,
	canvasToPngBytes
} from './image/ops';
import { segmentForeground, type SegmentProgress } from './segment/segment';
import { traceMask } from './vector/trace';
import { THRESHOLD_AUTO } from '@cadit-app/potrace-ts';

function triggerDownload(data: Blob | Uint8Array | string, filename: string, type: string): void {
	const blob =
		data instanceof Blob ? data : new Blob([data as BlobPart], { type });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function safeName(ext: string): string {
	const base = store.doc.name.trim().replace(/[^\w.-]+/g, '_') || 'silhouetter';
	return `${base}.${ext}`;
}

/** Import an image file and add it to the document fitted to the page. */
export async function importImage(file: File): Promise<ImageLayer> {
	const { width, height, src } = await probeImage(file);
	const source = { id: newId('src'), src, width, height, dpi: 300 };
	store.addSource(source);
	await loadSource(source);

	const maxW = store.doc.page.width * 0.9;
	const maxH = store.doc.page.height * 0.9;
	const ratio = width / height;
	let w = maxW;
	let h = w / ratio;
	if (h > maxH) {
		h = maxH;
		w = h * ratio;
	}

	const layer: ImageLayer = {
		id: newId('layer'),
		kind: 'image',
		name: file.name.replace(/\.[^.]+$/, '') || 'Image',
		visible: true,
		locked: false,
		opacity: 1,
		x: (store.doc.page.width - w) / 2,
		y: (store.doc.page.height - h) / 2,
		width: w,
		height: h,
		rotation: 0,
		sourceId: source.id
	};
	store.addLayer(layer);
	return layer;
}

export interface SegmentLayerResult {
	layer: SubjectLayer;
	height: number;
	width: number;
}

/**
 * Run background removal on a layer, derive its cut outline and promote it to a
 * subject layer.
 */
export async function segmentLayer(
	layerId: string,
	onProgress?: SegmentProgress
): Promise<Layer> {
	const layer = store.doc.layers.find((l) => l.id === layerId);
	if (!layer) throw new Error('Layer not found');
	const source = store.sources[layer.sourceId];
	if (!source) throw new Error('Missing image source for layer');

	const blob = await fetch(source.src).then((r) => r.blob());
	const result = await segmentForeground(blob, onProgress);

	// The foreground and the original are aligned, so trace the mask at source
	// resolution. Trace with slightly smoothed corners; further smoothing and
	// expansion are applied live from the layer controls.
	const minSide = Math.min(result.width, result.height);
	const existing = layer.kind === 'subject' ? layer : null;
	const traceDespeckle = existing?.traceDespeckle ?? Math.max(4, Math.round(minSide * 0.0015));
	const traceThreshold = existing?.traceThreshold ?? 128;
	const traceAutoThreshold = existing?.traceAutoThreshold ?? false;
	const cutExpandMm = existing?.cutExpandMm ?? 2;
	const cutSmooth = existing?.cutSmooth ?? 0.35;

	const polygons = traceMask(result.maskCanvas, {
		turdsize: traceDespeckle,
		alphamax: 1.0,
		threshold: traceAutoThreshold ? THRESHOLD_AUTO : traceThreshold
	});

	store.updateLayer(layer.id, {
		kind: 'subject',
		maskDataUrl: result.maskDataUrl,
		cutPolygons: polygons,
		cutExpandMm,
		cutSmooth,
		traceThreshold,
		traceAutoThreshold,
		traceDespeckle
	} as Partial<Layer>);

	await loadMask(layer.id, result.maskDataUrl);

	const updated = store.doc.layers.find((l) => l.id === layerId);
	if (!updated) throw new Error('Layer disappeared during segmentation');
	return updated;
}

/** Load a subject layer's mask into a canvas ready for tracing. */
async function maskCanvasForLayer(layer: SubjectLayer) {
	const stored = layer.maskDataUrl;
	if (!stored) throw new Error('Run background removal before tracing.');
	const mask = getMask(layer.id) ?? (await loadMask(layer.id, stored));
	const canvas = createCanvas(mask.naturalWidth, mask.naturalHeight);
	get2d(canvas, true).drawImage(mask, 0, 0);
	return canvas;
}

/**
 * Re-trace a subject layer's outline from its stored mask using the layer's
 * current threshold and despeckle settings. Cheap enough to run on demand
 * since it does not re-run the segmentation model.
 */
export async function retraceLayer(layerId: string): Promise<void> {
	const layer = store.doc.layers.find((l) => l.id === layerId);
	if (!layer || layer.kind !== 'subject') throw new Error('Select a traced layer first.');

	const canvas = await maskCanvasForLayer(layer);
	const polygons = traceMask(canvas, {
		turdsize: layer.traceDespeckle,
		alphamax: 1.0,
		threshold: layer.traceAutoThreshold ? THRESHOLD_AUTO : layer.traceThreshold
	});

	store.updateLayer(layerId, { cutPolygons: polygons } as Partial<Layer>);
}

export interface ExportFlags {
	includeArtwork?: boolean;
	includeMarks?: boolean;
	includeCutLine?: boolean;
}

export async function downloadPdf(flags: ExportFlags = {}): Promise<void> {
	// pdf-lib is only needed at export time; keep it out of the initial bundle.
	const { exportPdf } = await import('./export/pdf');
	const bytes = await exportPdf({
		doc: store.doc,
		getSource,
		getMask: (layer) => getMask(layer.id),
		...flags
	});
	triggerDownload(bytes, safeName('pdf'), 'application/pdf');
}

export async function downloadSvg(flags: ExportFlags = {}): Promise<void> {
	const { exportSvg } = await import('./export/svg');
	const svg = await exportSvg({
		doc: store.doc,
		getSource,
		getMask: (layer) => getMask(layer.id),
		...flags
	});
	triggerDownload(svg, safeName('svg'), 'image/svg+xml');
}

export async function downloadPng(): Promise<void> {
	const artwork = renderArtwork(store.doc, getSource, (layer) => getMask(layer.id));
	const bytes = await canvasToPngBytes(artwork);
	triggerDownload(bytes, safeName('png'), 'image/png');
}

/** Render the flattened artwork to a data URL for thumbnails / previews. */
export function renderPreviewDataUrl(scale = 1): string {
	const artwork = renderArtwork(store.doc, getSource, (layer) => getMask(layer.id));
	const canvas = createCanvas(artwork.width * scale, artwork.height * scale);
	get2d(canvas).drawImage(artwork as unknown as CanvasImageSource, 0, 0, canvas.width, canvas.height);
	return (canvas as HTMLCanvasElement).toDataURL?.('image/png') ?? '';
}
