import {
	store,
	getSource,
	getMask,
	loadSource,
	applyMaskStrokes,
	applyMaskLayer,
	maskPixelSize,
	invalidateMask,
} from './state.svelte';
import { newId } from './doc.svelte';
import type { ImageLayer, Layer, MaskLayer, MaskStroke, MaskableLayer, SubjectLayer } from './types';
import { createCanvas, get2d, probeImage, renderArtwork, canvasToPngBytes } from './image/ops';
import { drawInPixelSpace } from './geometry/transform';
import { segmentForeground, type SegmentProgress } from './segment/segment';
import { traceMask } from './vector/trace';
import { THRESHOLD_AUTO } from '@cadit-app/potrace-ts';
import { toProjectFile, fromProjectFile, PROJECT_EXTENSION } from './project';
import {
	saveProjectToStorage,
	readProjectFromStorage,
	deleteProjectFromStorage,
} from './projectStorage.svelte';

function triggerDownload(data: Blob | Uint8Array | string, filename: string, type: string): void {
	const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
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
		sourceId: source.id,
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
export async function segmentLayer(layerId: string, onProgress?: SegmentProgress): Promise<Layer> {
	const layer = store.doc.layers.find((l) => l.id === layerId);
	if (!layer) throw new Error('Layer not found');
	if (layer.kind === 'mask') throw new Error('Select an image layer to remove its background.');
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
		threshold: traceAutoThreshold ? THRESHOLD_AUTO : traceThreshold,
	});

	invalidateMask(layer.id);
	store.updateLayer(layer.id, {
		kind: 'subject',
		maskDataUrl: result.maskDataUrl,
		cutPolygons: polygons,
		cutExpandMm,
		cutSmooth,
		traceThreshold,
		traceAutoThreshold,
		traceDespeckle,
		maskStrokes: [],
	} as Partial<Layer>);

	const segmented = store.doc.layers.find((l) => l.id === layerId);
	if (segmented && segmented.kind === 'subject') await applyMaskStrokes(segmented);

	// Give the design an editable punch mask aligned to the subject so the
	// removed background can then be carved out of every layer at once.
	const subject = store.doc.layers.find((l) => l.id === layerId);
	ensureMaskLayer(subject);

	const updated = store.doc.layers.find((l) => l.id === layerId);
	if (!updated) throw new Error('Layer disappeared during segmentation');
	return updated;
}

/** Natural pixel size of a layer's bitmap, if it has one. */
function layerPixelSize(layer: Layer): { width: number; height: number } {
	if (layer.kind === 'mask') return { width: layer.pixelWidth, height: layer.pixelHeight };
	const source = getSource(layer.sourceId);
	return { width: source?.naturalWidth ?? 1, height: source?.naturalHeight ?? 1 };
}

/** Create an empty document mask layer, optionally aligned to a reference layer. */
export function addMaskLayer(reference?: Layer): MaskLayer {
	const page = store.doc.page;
	const ref = reference && reference.kind !== 'mask' ? reference : undefined;
	const pxPerMm = store.doc.dpi / 25.4;
	const pixels = ref
		? layerPixelSize(ref)
		: {
				width: Math.max(1, Math.round(page.width * pxPerMm)),
				height: Math.max(1, Math.round(page.height * pxPerMm)),
			};
	const layer: MaskLayer = {
		id: newId('layer'),
		kind: 'mask',
		name: 'Mask',
		visible: true,
		locked: false,
		opacity: 1,
		x: ref ? ref.x : 0,
		y: ref ? ref.y : 0,
		width: ref ? ref.width : page.width,
		height: ref ? ref.height : page.height,
		rotation: ref ? ref.rotation : 0,
		pixelWidth: Math.max(1, Math.round(pixels.width)),
		pixelHeight: Math.max(1, Math.round(pixels.height)),
		maskDataUrl: null,
		maskStrokes: [],
	};
	store.addLayer(layer);
	return layer;
}

/** Return the document's mask layer, creating one if none exists yet. */
export function ensureMaskLayer(reference?: Layer): MaskLayer {
	const existing = store.doc.layers.find((l): l is MaskLayer => l.kind === 'mask');
	if (existing) return existing;
	return addMaskLayer(reference);
}

/** Punch every visible mask layer's holes out of a canvas (in `target` space). */
async function punchHoles(ctx: CanvasRenderingContext2D, target: MaskableLayer): Promise<void> {
	const size = maskPixelSize(target);
	const toFrame = { layer: target, pixelWidth: size.width, pixelHeight: size.height };
	for (const layer of store.doc.layers) {
		if (layer.kind !== 'mask' || !layer.visible) continue;
		const hole = getMask(layer.id);
		if (!hole) continue;
		const maskSize = maskPixelSize(layer);
		const fromFrame = {
			layer,
			pixelWidth: maskSize.width,
			pixelHeight: maskSize.height,
		};
		ctx.globalCompositeOperation = 'destination-out';
		drawInPixelSpace(ctx, hole as unknown as CanvasImageSource, fromFrame, toFrame);
	}
	ctx.globalCompositeOperation = 'source-over';
}

/** Load a subject layer's effective (edited) mask into a canvas for tracing. */
async function maskCanvasForLayer(layer: SubjectLayer) {
	if (!layer.maskDataUrl) throw new Error('Run background removal before tracing.');
	const mask = (await applyMaskStrokes(layer)) ?? getMask(layer.id);
	if (!mask) throw new Error('Run background removal before tracing.');
	const canvas = createCanvas(mask.naturalWidth, mask.naturalHeight);
	const ctx = get2d(canvas, true);
	ctx.drawImage(mask, 0, 0);
	// The document mask punches through subjects too, so the cut must follow it.
	for (const candidate of store.doc.layers) {
		if (candidate.kind === 'mask' && candidate.visible && !getMask(candidate.id)) {
			await applyMaskLayer(candidate);
		}
	}
	await punchHoles(ctx, layer);
	return canvas;
}

/**
 * Append a brush stroke to a subject's keep mask or a mask layer's punch mask
 * and refresh the effective mask.
 */
export async function addMaskStroke(layerId: string, stroke: MaskStroke): Promise<void> {
	const layer = store.doc.layers.find((l) => l.id === layerId);
	if (!layer || (layer.kind !== 'subject' && layer.kind !== 'mask')) {
		throw new Error('Select a subject or mask layer first.');
	}
	store.commit((d) => {
		const l = d.layers.find((x) => x.id === layerId);
		if (l && (l.kind === 'subject' || l.kind === 'mask')) l.maskStrokes.push(stroke);
	});
	await refreshMaskLayer(layerId);
}

/** Remove all brush strokes from a subject's mask or a mask layer. */
export async function clearMaskStrokes(layerId: string): Promise<void> {
	const layer = store.doc.layers.find((l) => l.id === layerId);
	if (!layer || (layer.kind !== 'subject' && layer.kind !== 'mask')) return;
	store.commit((d) => {
		const l = d.layers.find((x) => x.id === layerId);
		if (l && (l.kind === 'subject' || l.kind === 'mask')) l.maskStrokes = [];
	});
	await refreshMaskLayer(layerId);
}

/** Recompute a maskable layer's mask and re-trace every subject's outline. */
async function refreshMaskLayer(layerId: string): Promise<void> {
	const layer = store.doc.layers.find((l) => l.id === layerId);
	if (layer && (layer.kind === 'subject' || layer.kind === 'mask')) {
		if (layer.kind === 'mask') await applyMaskLayer(layer);
		else await applyMaskStrokes(layer);
	}
	await retraceSubjects();
}

/** Re-trace every subject layer so its cut line follows the current masks. */
export async function retraceSubjects(): Promise<void> {
	for (const layer of store.doc.layers) {
		if (layer.kind === 'subject' && layer.maskDataUrl) await retraceLayer(layer.id);
	}
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
		threshold: layer.traceAutoThreshold ? THRESHOLD_AUTO : layer.traceThreshold,
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
		...flags,
	});
	triggerDownload(bytes, safeName('pdf'), 'application/pdf');
}

export async function downloadSvg(flags: ExportFlags = {}): Promise<void> {
	const { exportSvg } = await import('./export/svg');
	const svg = await exportSvg({
		doc: store.doc,
		getSource,
		getMask: (layer) => getMask(layer.id),
		...flags,
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
	get2d(canvas).drawImage(
		artwork as unknown as CanvasImageSource,
		0,
		0,
		canvas.width,
		canvas.height,
	);
	return (canvas as HTMLCanvasElement).toDataURL?.('image/png') ?? '';
}

/** Save the current project to browser storage under a name. Returns the name. */
export async function saveProject(name?: string): Promise<string> {
	const trimmed = (name ?? store.doc.name).trim() || 'Untitled';
	store.doc.name = trimmed;
	const project = await toProjectFile(store.snapshot(), store.sources);
	project.name = trimmed;
	saveProjectToStorage(trimmed, project);
	return trimmed;
}

/** Download the current project as a `.silhouetter.json` file. */
export async function downloadProject(): Promise<void> {
	const project = await toProjectFile(store.snapshot(), store.sources);
	const base = project.name.trim().replace(/[^\w.-]+/g, '_') || 'silhouetter';
	triggerDownload(
		JSON.stringify(project, null, 2),
		`${base}.${PROJECT_EXTENSION}`,
		'application/json',
	);
}

/** Replace the current document and source registry with a parsed project. */
async function applyProject(project: unknown): Promise<void> {
	const { doc, sources } = fromProjectFile(project);
	store.load(doc);
	store.sources = {};
	for (const source of Object.values(sources)) {
		store.addSource(source);
		await loadSource(source);
	}
	for (const layer of store.doc.layers) {
		if (layer.kind === 'subject' && layer.maskDataUrl) await applyMaskStrokes(layer);
		else if (layer.kind === 'mask') await applyMaskLayer(layer);
	}
	store.selectedId = null;
}

/** Load a project saved in browser storage. */
export async function loadProject(name: string): Promise<void> {
	await applyProject(await readProjectFromStorage(name));
}

/** Load a project from a user-selected file. */
export async function openProject(file: File): Promise<void> {
	const text = await file.text();
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error('That file is not valid JSON.');
	}
	await applyProject(parsed);
}

/** Remove a project from browser storage. */
export async function deleteProject(name: string): Promise<void> {
	await deleteProjectFromStorage(name);
}
