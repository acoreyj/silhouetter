import type { DocumentModel, ImageSource, Layer, Point, SubjectLayer } from '$lib/types';
import { mmToPx } from '$lib/units';

export type Canvas2D = HTMLCanvasElement | OffscreenCanvas;

/** Create a 2D canvas, preferring OffscreenCanvas when available. */
export function createCanvas(width: number, height: number): Canvas2D {
	if (typeof OffscreenCanvas !== 'undefined') {
		return new OffscreenCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
	}
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(width));
	canvas.height = Math.max(1, Math.round(height));
	return canvas;
}

export function get2d(canvas: Canvas2D, willReadFrequently = false): CanvasRenderingContext2D {
	const ctx = canvas.getContext('2d', { willReadFrequently }) as CanvasRenderingContext2D | null;
	if (!ctx) throw new Error('Unable to acquire a 2D context');
	return ctx;
}

/** Load an image element from an object/data URL. */
export function loadImageElement(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error(`Failed to load image: ${src.slice(0, 64)}`));
		img.src = src;
	});
}

/** Decode a Blob into an HTMLImageElement via an object URL. */
export async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
	const url = URL.createObjectURL(blob);
	try {
		return await loadImageElement(url);
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** Read a File/Blob and report its natural pixel size. */
export async function probeImage(
	blob: Blob
): Promise<{ image: HTMLImageElement; width: number; height: number; src: string }> {
	const src = URL.createObjectURL(blob);
	const image = await loadImageElement(src);
	return { image, width: image.naturalWidth, height: image.naturalHeight, src };
}

export async function canvasToPngBytes(canvas: Canvas2D): Promise<Uint8Array> {
	if ('convertToBlob' in canvas) {
		const blob = await canvas.convertToBlob({ type: 'image/png' });
		return new Uint8Array(await blob.arrayBuffer());
	}
	const blob = await new Promise<Blob>((resolve, reject) =>
		(canvas as HTMLCanvasElement).toBlob(
			(b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
			'image/png'
		)
	);
	return new Uint8Array(await blob.arrayBuffer());
}

export function canvasToDataUrl(canvas: Canvas2D): string {
	if ('convertToBlob' in canvas) {
		// OffscreenCanvas path: synchronously unavailable, fall back to a DOM canvas.
		const dom = document.createElement('canvas');
		dom.width = canvas.width;
		dom.height = canvas.height;
		get2d(dom).drawImage(canvas as unknown as CanvasImageSource, 0, 0);
		return dom.toDataURL('image/png');
	}
	return (canvas as HTMLCanvasElement).toDataURL('image/png');
}

/**
 * Build an aligned alpha mask for a source image. Pixels at or above the alpha
 * threshold become opaque black, everything else becomes transparent.
 */
export function buildAlphaMask(
	source: HTMLImageElement,
	threshold = 8
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
	mask: HTMLImageElement
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

/** Render a single layer (with optional mask) into its own tightly-fit canvas. */function rasterizeLayer(
	layer: Layer,
	source: HTMLImageElement,
	mask: HTMLImageElement | undefined,
	pxPerMm: number
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

/** Render all visible layers into a canvas covering exactly the trim box. */
export function renderTrim(
	doc: DocumentModel,
	getSource: (id: string) => HTMLImageElement | undefined,
	getMask: (layer: SubjectLayer) => HTMLImageElement | undefined,
	pxPerMm: number
): Canvas2D {
	const w = Math.round(doc.page.width * pxPerMm);
	const h = Math.round(doc.page.height * pxPerMm);
	const canvas = createCanvas(w, h);
	const ctx = get2d(canvas);

	if (doc.background) {
		ctx.fillStyle = doc.background;
		ctx.fillRect(0, 0, w, h);
	}

	for (const layer of doc.layers) {
		if (!layer.visible || layer.opacity <= 0) continue;
		const source = getSource(layer.sourceId);
		if (!source) continue;
		const mask = layer.kind === 'subject' ? getMask(layer) : undefined;
		const raster = rasterizeLayer(layer, source, mask, pxPerMm);
		const cx = (layer.x + layer.width / 2) * pxPerMm;
		const cy = (layer.y + layer.height / 2) * pxPerMm;
		ctx.save();
		ctx.globalAlpha = layer.opacity;
		ctx.translate(cx, cy);
		ctx.rotate((layer.rotation * Math.PI) / 180);
		ctx.drawImage(raster as unknown as CanvasImageSource, -raster.width / 2, -raster.height / 2);
		ctx.restore();
	}

	return canvas;
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
	solidColor: string
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
			b
		);
	};
	drawCorner(0, 0, 0, 0);
	drawCorner(w - cornerSize, 0, w + b, 0);
	drawCorner(0, h - cornerSize, 0, h + b);
	drawCorner(w - cornerSize, h - cornerSize, w + b, h + b);

	return out;
}

/** Full artwork render (trim + optional bleed) at the document DPI. */
export function renderArtwork(
	doc: DocumentModel,
	getSource: (id: string) => HTMLImageElement | undefined,
	getMask: (layer: SubjectLayer) => HTMLImageElement | undefined
): Canvas2D {
	const pxPerMm = doc.dpi / 25.4;
	const trim = renderTrim(doc, getSource, getMask, pxPerMm);
	const bleedPx = doc.bleed.enabled ? mmToPx(doc.bleed.amountMm, doc.dpi) : 0;
	return addBleed(trim, bleedPx, doc.bleed.mode, doc.bleed.solidColor);
}

/** Scale polygons (in source pixel space) to millimetres within a layer box. */
export function polygonsToMm(
	polygons: Point[][],
	sourceWidth: number,
	sourceHeight: number,
	layer: Layer
): Point[][] {
	const sx = layer.width / sourceWidth;
	const sy = layer.height / sourceHeight;
	return polygons.map((poly) => poly.map((p) => ({ x: p.x * sx, y: p.y * sy })));
}

/**
 * Convert cut polygons expressed in layer-local millimetres into absolute page
 * millimetres, applying the layer's rotation around its centre.
 */
export function transformPolygonsToPage(polygons: Point[][], layer: Layer): Point[][] {
	const cx = layer.x + layer.width / 2;
	const cy = layer.y + layer.height / 2;
	const rad = (layer.rotation * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	return polygons.map((poly) =>
		poly.map((p) => {
			const dx = p.x - layer.width / 2;
			const dy = p.y - layer.height / 2;
			return {
				x: cx + dx * cos - dy * sin,
				y: cy + dx * sin + dy * cos
			};
		})
	);
}
