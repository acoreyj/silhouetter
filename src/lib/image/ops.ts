import type { DocumentModel, Layer, Point, Rect } from '$lib/types';
import { mmToPx } from '$lib/units';
import { buildTrimPolygons, polygonsBounds } from '$lib/geometry/shape';
import { offsetPolygons } from '$lib/vector/trace';
import {
	blobToImage,
	canvasToDataUrl,
	canvasToPngBytes,
	createCanvas,
	get2d,
	loadImageElement,
	probeImage,
	type Canvas2D,
} from './canvas';

export {
	blobToImage,
	canvasToDataUrl,
	canvasToPngBytes,
	createCanvas,
	get2d,
	loadImageElement,
	probeImage,
};
export type { Canvas2D };

/**
 * Build an aligned alpha mask for a source image. Pixels at or above the alpha
 * threshold become opaque black, everything else becomes transparent.
 */
export function buildAlphaMask(
	source: HTMLImageElement,
	threshold = 8,
): { canvas: Canvas2D; dataUrl: string } {
	const canvas = createCanvas(source.naturalWidth, source.naturalHeight);
	const ctx = get2d(canvas, true);
	ctx.drawImage(source, 0, 0);
	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const d = imageData.data;
	for (let i = 0; i < d.length; i += 4) {
		const a = d[i + 3];
		if (a >= threshold) {
			d[i] = 0;
			d[i + 1] = 0;
			d[i + 2] = 0;
			d[i + 3] = 255;
		} else {
			d[i + 3] = 0;
		}
	}
	ctx.putImageData(imageData, 0, 0);
	return { canvas, dataUrl: canvasToDataUrl(canvas) };
}

const maskedCache = new Map<string, Canvas2D>();

/**
 * Composite a source image with an alpha mask (black = keep) into a single
 * canvas so it can be drawn as an ordinary image node. Results are cached by
 * key until the cache exceeds a small bound.
 */
export function composeMasked(
	key: string,
	source: HTMLImageElement,
	mask: HTMLImageElement,
): Canvas2D {
	const cached = maskedCache.get(key);
	if (cached) return cached;
	const canvas = createCanvas(source.naturalWidth, source.naturalHeight);
	const ctx = get2d(canvas);
	ctx.drawImage(source, 0, 0);
	ctx.globalCompositeOperation = 'destination-in';
	ctx.drawImage(mask, 0, 0, canvas.width, canvas.height);
	ctx.globalCompositeOperation = 'source-over';
	if (maskedCache.size > 24) maskedCache.clear();
	maskedCache.set(key, canvas);
	return canvas;
}

/** Render a single layer (with optional mask) into its own tightly-fit canvas. */
function rasterizeLayer(
	layer: Layer,
	source: HTMLImageElement,
	mask: HTMLImageElement | undefined,
	pxPerMm: number,
): Canvas2D {
	const w = Math.max(1, Math.round(layer.width * pxPerMm));
	const h = Math.max(1, Math.round(layer.height * pxPerMm));
	const canvas = createCanvas(w, h);
	const ctx = get2d(canvas);
	ctx.drawImage(source, 0, 0, w, h);
	if (mask) {
		ctx.globalCompositeOperation = 'destination-in';
		ctx.drawImage(mask, 0, 0, w, h);
		ctx.globalCompositeOperation = 'source-over';
	}
	return canvas;
}

/** Punch a mask layer's holes out of a canvas already in page-pixel space. */
function punchMaskLayer(
	ctx: CanvasRenderingContext2D,
	layer: Layer,
	mask: HTMLImageElement,
	pxPerMm: number,
	offX = 0,
	offY = 0,
): void {
	const w = Math.max(1, layer.width * pxPerMm);
	const h = Math.max(1, layer.height * pxPerMm);
	const cx = (layer.x + layer.width / 2) * pxPerMm + offX;
	const cy = (layer.y + layer.height / 2) * pxPerMm + offY;
	ctx.save();
	ctx.globalCompositeOperation = 'destination-out';
	ctx.translate(cx, cy);
	ctx.rotate((layer.rotation * Math.PI) / 180);
	ctx.drawImage(mask as unknown as CanvasImageSource, -w / 2, -h / 2, w, h);
	ctx.restore();
}

/** Render all visible layers into a canvas covering `region` (page mm). */
export function renderTrim(
	doc: DocumentModel,
	getSource: (id: string) => HTMLImageElement | undefined,
	getMask: (layer: Layer) => HTMLImageElement | undefined,
	pxPerMm: number,
	region: Rect = { x: 0, y: 0, width: doc.page.width, height: doc.page.height },
): Canvas2D {
	const w = Math.max(1, Math.round(region.width * pxPerMm));
	const h = Math.max(1, Math.round(region.height * pxPerMm));
	const offX = -region.x * pxPerMm;
	const offY = -region.y * pxPerMm;
	const canvas = createCanvas(w, h);
	const ctx = get2d(canvas);

	if (doc.background) {
		ctx.fillStyle = doc.background;
		ctx.fillRect(0, 0, w, h);
	}

	for (const layer of doc.layers) {
		if (!layer.visible || layer.opacity <= 0 || layer.kind === 'mask') continue;
		const source = getSource(layer.sourceId);
		if (!source) continue;
		const mask = layer.kind === 'subject' ? getMask(layer) : undefined;
		const raster = rasterizeLayer(layer, source, mask, pxPerMm);
		const cx = (layer.x + layer.width / 2) * pxPerMm + offX;
		const cy = (layer.y + layer.height / 2) * pxPerMm + offY;
		ctx.save();
		ctx.globalAlpha = layer.opacity;
		ctx.translate(cx, cy);
		ctx.rotate((layer.rotation * Math.PI) / 180);
		ctx.drawImage(raster as unknown as CanvasImageSource, -raster.width / 2, -raster.height / 2);
		ctx.restore();
	}

	// Document mask layers punch through everything above.
	for (const layer of doc.layers) {
		if (layer.kind !== 'mask' || !layer.visible || layer.opacity <= 0) continue;
		const mask = getMask(layer);
		if (mask) punchMaskLayer(ctx, layer, mask, pxPerMm, offX, offY);
	}

	return canvas;
}

/**
 * Keep only the pixels of `canvas` that fall inside the given page-millimetre
 * polygons. `origin` is the page-mm coordinate of the canvas top-left corner.
 */
export function clipCanvasToPolygons(
	canvas: Canvas2D,
	polygonsPageMm: Point[][],
	pxPerMm: number,
	origin: Point = { x: 0, y: 0 },
): void {
	if (polygonsPageMm.length === 0) return;
	const mask = createCanvas(canvas.width, canvas.height);
	const mctx = get2d(mask);
	mctx.fillStyle = '#000';
	mctx.beginPath();
	for (const poly of polygonsPageMm) {
		if (poly.length < 3) continue;
		mctx.moveTo((poly[0].x - origin.x) * pxPerMm, (poly[0].y - origin.y) * pxPerMm);
		for (let i = 1; i < poly.length; i++) {
			mctx.lineTo((poly[i].x - origin.x) * pxPerMm, (poly[i].y - origin.y) * pxPerMm);
		}
		mctx.closePath();
	}
	mctx.fill('nonzero');

	const ctx = get2d(canvas);
	ctx.globalCompositeOperation = 'destination-in';
	ctx.drawImage(mask as unknown as CanvasImageSource, 0, 0);
	ctx.globalCompositeOperation = 'source-over';
}

/**
 * Expand a trim-sized canvas by `bleedPx` on each side. In `mirror` mode the
 * border is filled with reflections of the artwork edges; in `solid` mode it is
 * filled with a flat colour.
 */
export function addBleed(
	trim: Canvas2D,
	bleedPx: number,
	mode: 'mirror' | 'solid',
	solidColor: string,
): Canvas2D {
	const b = Math.max(0, Math.round(bleedPx));
	const w = trim.width;
	const h = trim.height;
	if (b === 0) return trim;

	const out = createCanvas(w + b * 2, h + b * 2);
	const ctx = get2d(out);

	if (mode === 'solid') {
		ctx.fillStyle = solidColor || '#ffffff';
		ctx.fillRect(0, 0, out.width, out.height);
		ctx.drawImage(trim as unknown as CanvasImageSource, b, b);
		return out;
	}

	// Mirror mode. Draw the centre first, then reflect each edge inwards.
	ctx.drawImage(trim as unknown as CanvasImageSource, b, b);

	// Top
	ctx.save();
	ctx.translate(b, b);
	ctx.scale(1, -1);
	ctx.drawImage(trim as unknown as CanvasImageSource, 0, 0, w, b, 0, 0, w, b);
	ctx.restore();

	// Bottom
	ctx.save();
	ctx.translate(b, h + b);
	ctx.scale(1, -1);
	ctx.drawImage(trim as unknown as CanvasImageSource, 0, h - b, w, b, 0, 0, w, b);
	ctx.restore();

	// Left
	ctx.save();
	ctx.translate(b, b);
	ctx.scale(-1, 1);
	ctx.drawImage(trim as unknown as CanvasImageSource, 0, 0, b, h, 0, 0, b, h);
	ctx.restore();

	// Right
	ctx.save();
	ctx.translate(w + b, b);
	ctx.scale(-1, 1);
	ctx.drawImage(trim as unknown as CanvasImageSource, w - b, 0, b, h, 0, 0, b, h);
	ctx.restore();

	// Corners: smear the nearest artwork pixel diagonally.
	const cornerSize = Math.min(1, w, h);
	const drawCorner = (sx: number, sy: number, dx: number, dy: number) => {
		ctx.drawImage(
			trim as unknown as CanvasImageSource,
			sx,
			sy,
			cornerSize,
			cornerSize,
			dx,
			dy,
			b,
			b,
		);
	};
	drawCorner(0, 0, 0, 0);
	drawCorner(w - cornerSize, 0, w + b, 0);
	drawCorner(0, h - cornerSize, 0, h + b);
	drawCorner(w - cornerSize, h - cornerSize, w + b, h + b);

	return out;
}

/**
 * Page-millimetre rectangle the flattened artwork covers: the document trim
 * outline (which may overflow the page for a bookmark) plus the bleed margin.
 */
export function artworkRect(
	doc: DocumentModel,
	getSource: (id: string) => HTMLImageElement | undefined,
): Rect {
	const bleed = doc.bleed.enabled ? doc.bleed.amountMm : 0;
	let content: Rect = { x: 0, y: 0, width: doc.page.width, height: doc.page.height };
	if (doc.trimShape !== 'rect') {
		const bounds = polygonsBounds(buildTrimPolygons(doc, getSource));
		if (bounds) content = bounds;
	}
	return {
		x: content.x - bleed,
		y: content.y - bleed,
		width: content.width + bleed * 2,
		height: content.height + bleed * 2,
	};
}

/**
 * Full artwork render (trim + optional bleed) at the document DPI. For a
 * non-rectangular trim, the result is clipped to the trim outline (expanded by
 * the bleed amount) so the printed artwork follows the bookmark silhouette.
 * The canvas covers {@link artworkRect}, so a bookmark head that overflows the
 * page is rendered too.
 */
export function renderArtwork(
	doc: DocumentModel,
	getSource: (id: string) => HTMLImageElement | undefined,
	getMask: (layer: Layer) => HTMLImageElement | undefined,
): Canvas2D {
	const pxPerMm = doc.dpi / 25.4;
	const bleed = doc.bleed.enabled ? doc.bleed.amountMm : 0;
	const rect = artworkRect(doc, getSource);
	const trimRegion: Rect = {
		x: rect.x + bleed,
		y: rect.y + bleed,
		width: Math.max(0.01, rect.width - bleed * 2),
		height: Math.max(0.01, rect.height - bleed * 2),
	};
	const trim = renderTrim(doc, getSource, getMask, pxPerMm, trimRegion);
	const bleedPx = doc.bleed.enabled ? mmToPx(doc.bleed.amountMm, doc.dpi) : 0;
	const art = addBleed(trim, bleedPx, doc.bleed.mode, doc.bleed.solidColor);

	if (doc.trimShape === 'rect') return art;

	const shape = buildTrimPolygons(doc, getSource);
	const expanded =
		bleed > 0
			? offsetPolygons(shape, bleed, { jointType: 'jtRound', precision: 0.05 })
			: shape;
	clipCanvasToPolygons(art, expanded, pxPerMm, { x: rect.x, y: rect.y });
	return art;
}
