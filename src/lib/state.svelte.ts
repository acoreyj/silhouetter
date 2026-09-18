import { DocumentStore } from './doc.svelte';
import type {
	ImageSource,
	Layer,
	MaskableLayer,
	MaskLayer,
	MaskStroke,
	MaskStrokeMode,
	SubjectLayer,
} from './types';
import { createCanvas, get2d, loadImageElement, canvasToDataUrl } from './image/canvas';

export { DEFAULT_PAGE_SIZES, DPI_PRESETS, createDefaultDocument, newId } from './doc.svelte';
export { SHEET_PRESETS, sheetSizeFor } from './export/impose';

/** Single reactive document store for the whole editor. */
export const store = new DocumentStore();

/**
 * Mask-editing tool. `brush` paints a stroke; `magic` flood-fills on click;
 * `slice` removes everything on one side of a straight line.
 */
export type MaskTool = 'brush' | 'magic' | 'slice';

/** Transient mask-editing tool state (not part of the document/undo history). */
export const brush = $state({
	active: false,
	tool: 'brush' as MaskTool,
	mode: 'erase' as MaskStrokeMode,
	/** Brush radius in page millimetres. */
	radiusMm: 3,
	/** Magic-eraser colour tolerance (Euclidean RGB distance, 0-255). */
	tolerance: 32,
	/** Side of the slice line to remove: `1` or `-1`. Flipped by the UI. */
	sliceSide: 1 as 1 | -1,
});

const imageCache = new Map<string, HTMLImageElement>();
/** Raw segmentation masks, before any brush edits. */
const maskBaseCache = new Map<string, HTMLImageElement>();
/** Effective masks (base + brush strokes), used for preview and export. */
const maskCache = new Map<string, HTMLImageElement>();
const maskBasePromises = new Map<string, Promise<HTMLImageElement>>();
/** Bumped whenever a layer's effective mask is recomputed. */
const maskRevisions = new Map<string, number>();

/**
 * Reactive mirror of {@link maskRevisions} for consumers that rebuild derived
 * data (e.g. the preview punch overlay). The per-layer map itself is not
 * reactive, so rasterization happens asynchronously after the stroke commit.
 */
export const maskRevision = $state({ value: 0 });

/**
 * Reactive mirror of {@link imageCache}. Loading a source is asynchronous and
 * happens after the layers that reference it are already on screen (e.g. when
 * opening a project), so derived render data must re-read the cache when an
 * image finishes decoding. Reading {@link getSource} tracks this counter.
 */
export const sourceRevision = $state({ value: 0 });

export function getSource(id: string): HTMLImageElement | undefined {
	void sourceRevision.value;
	return imageCache.get(id);
}

export async function loadSource(source: ImageSource): Promise<HTMLImageElement> {
	const cached = imageCache.get(source.id);
	if (cached) return cached;
	const el = await loadImageElement(source.src);
	imageCache.set(source.id, el);
	sourceRevision.value++;
	return el;
}

/** Load (and cache) a layer's raw segmentation mask. */
export async function loadMask(layerId: string, dataUrl: string): Promise<HTMLImageElement> {
	const cached = maskBaseCache.get(layerId);
	if (cached) return cached;
	let promise = maskBasePromises.get(layerId);
	if (!promise) {
		promise = loadImageElement(dataUrl).then((el) => {
			maskBaseCache.set(layerId, el);
			maskBasePromises.delete(layerId);
			return el;
		});
		maskBasePromises.set(layerId, promise);
	}
	return promise;
}

/** Draw the shape of a brush stroke (a dot for single points, else a polyline). */
function paintStrokeShape(
	ctx: CanvasRenderingContext2D,
	points: MaskStroke['points'],
	radiusPx: number,
): void {
	if (points.length === 0) return;
	ctx.beginPath();
	if (points.length === 1) {
		ctx.arc(points[0].x, points[0].y, radiusPx, 0, Math.PI * 2);
		return;
	}
	ctx.moveTo(points[0].x, points[0].y);
	for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
}

/** Begin a path for a stored edit: filled polygons or a stroked centreline. */
function beginEditPath(
	ctx: CanvasRenderingContext2D,
	stroke: MaskStroke,
	radiusPx: number,
): void {
	ctx.beginPath();
	const polygons = stroke.fillPolygons;
	if (polygons && polygons.length > 0) {
		for (const poly of polygons) {
			if (poly.length < 3) continue;
			ctx.moveTo(poly[0].x, poly[0].y);
			for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
			ctx.closePath();
		}
		return;
	}
	paintStrokeShape(ctx, stroke.points, radiusPx);
}

/** True when an edit fills a region rather than stroking a centreline. */
function isFillEdit(stroke: MaskStroke): boolean {
	return !!stroke.fillPolygons && stroke.fillPolygons.length > 0;
}

/** Compact signature of a layer's stored mask edits, for reactive effects. */
export function maskEditSignature(strokes: MaskStroke[]): string {
	let points = 0;
	let fill = 0;
	for (const stroke of strokes) {
		points += stroke.points.length;
		if (stroke.fillPolygons) {
			for (const poly of stroke.fillPolygons) fill += poly.length;
		}
	}
	return `${strokes.length}:${points}:${fill}`;
}

/** Apply one brush stroke to a mask canvas. */
function applyStroke(
	ctx: CanvasRenderingContext2D,
	base: HTMLImageElement,
	stroke: MaskStroke,
): void {
	const radius = Math.max(0.5, stroke.radiusPx);
	const paint = (target: CanvasRenderingContext2D) => {
		target.strokeStyle = '#000';
		target.fillStyle = '#000';
		target.lineWidth = radius * 2;
		target.lineCap = 'round';
		target.lineJoin = 'round';
		if (isFillEdit(stroke) || stroke.points.length === 1) target.fill();
		else target.stroke();
	};

	if (stroke.mode === 'erase') {
		ctx.save();
		ctx.globalCompositeOperation = 'destination-out';
		beginEditPath(ctx, stroke, radius);
		paint(ctx);
		ctx.restore();
		return;
	}

	// Restore: redraw the base mask, clipped to the stroke shape.
	const w = base.naturalWidth;
	const h = base.naturalHeight;
	const tmp = createCanvas(w, h);
	const tctx = get2d(tmp);
	tctx.drawImage(base, 0, 0);
	tctx.globalCompositeOperation = 'destination-in';
	beginEditPath(tctx, stroke, radius);
	paint(tctx);
	tctx.globalCompositeOperation = 'source-over';
	ctx.drawImage(tmp as unknown as CanvasImageSource, 0, 0);
}

/**
 * Apply one brush stroke to a hole (punch) mask. `erase` subtracts from the
 * design (adds an opaque hole), `restore` fills it back in.
 */
function applyHoleStroke(ctx: CanvasRenderingContext2D, stroke: MaskStroke): void {
	const radius = Math.max(0.5, stroke.radiusPx);
	ctx.save();
	ctx.strokeStyle = '#000';
	ctx.fillStyle = '#000';
	ctx.lineWidth = radius * 2;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.globalCompositeOperation = stroke.mode === 'erase' ? 'source-over' : 'destination-out';
	beginEditPath(ctx, stroke, radius);
	if (isFillEdit(stroke) || stroke.points.length === 1) ctx.fill();
	else ctx.stroke();
	ctx.restore();
}

/** Build the effective keep-mask image for a subject's base mask + strokes. */
async function rasterizeStrokes(
	base: HTMLImageElement,
	strokes: MaskStroke[],
): Promise<HTMLImageElement> {
	const canvas = createCanvas(base.naturalWidth, base.naturalHeight);
	const ctx = get2d(canvas);
	ctx.drawImage(base, 0, 0);
	for (const stroke of strokes) applyStroke(ctx, base, stroke);
	return loadImageElement(canvasToDataUrl(canvas));
}

/** Recompute a subject layer's effective mask from its stored base mask and brush
 * strokes, caching the result. Returns the effective mask image.
 */
export async function applyMaskStrokes(layer: SubjectLayer): Promise<HTMLImageElement | undefined> {
	if (!layer.maskDataUrl) return undefined;
	const base = await loadMask(layer.id, layer.maskDataUrl);
	const effective =
		layer.maskStrokes.length === 0 ? base : await rasterizeStrokes(base, layer.maskStrokes);
	maskCache.set(layer.id, effective);
	maskRevisions.set(layer.id, (maskRevisions.get(layer.id) ?? 0) + 1);
	maskRevision.value++;
	return effective;
}

/**
 * Recompute a mask layer's punched (hole) bitmap from its base mask and brush
 * strokes. Opaque pixels are punched out of every other layer.
 */
export async function applyMaskLayer(layer: MaskLayer): Promise<HTMLImageElement | undefined> {
	const w = Math.max(1, Math.round(layer.pixelWidth));
	const h = Math.max(1, Math.round(layer.pixelHeight));
	const canvas = createCanvas(w, h);
	const ctx = get2d(canvas);
	if (layer.maskDataUrl) {
		const base = await loadMask(layer.id, layer.maskDataUrl);
		ctx.drawImage(base, 0, 0, w, h);
	}
	for (const stroke of layer.maskStrokes) applyHoleStroke(ctx, stroke);
	const effective = await loadImageElement(canvasToDataUrl(canvas));
	maskCache.set(layer.id, effective);
	maskRevisions.set(layer.id, (maskRevisions.get(layer.id) ?? 0) + 1);
	maskRevision.value++;
	return effective;
}

/** Natural pixel size of a maskable layer's mask bitmap. */
export function maskPixelSize(layer: MaskableLayer): { width: number; height: number } {
	if (layer.kind === 'mask') return { width: layer.pixelWidth, height: layer.pixelHeight };
	const source = getSource(layer.sourceId);
	return { width: source?.naturalWidth ?? 1, height: source?.naturalHeight ?? 1 };
}

/** Get a layer's effective (edited) mask, falling back to the raw base mask. */
export function getMask(layerId: string): HTMLImageElement | undefined {
	return maskCache.get(layerId) ?? maskBaseCache.get(layerId);
}

export function getMaskRevision(layerId: string): number {
	return maskRevisions.get(layerId) ?? 0;
}

export function getMaskForLayer(layer: Layer): HTMLImageElement | undefined {
	return layer.kind === 'subject' || layer.kind === 'mask' ? getMask(layer.id) : undefined;
}

/** Forget a layer's cached masks (e.g. after re-segmentation). */
export function invalidateMask(layerId: string): void {
	maskBaseCache.delete(layerId);
	maskCache.delete(layerId);
	maskBasePromises.delete(layerId);
	maskRevisions.set(layerId, (maskRevisions.get(layerId) ?? 0) + 1);
	maskRevision.value++;
}

export function releaseObjectUrls(): void {
	for (const source of Object.values(store.sources)) {
		if (source.src.startsWith('blob:')) URL.revokeObjectURL(source.src);
	}
}
