/**
 * Low-level canvas helpers with no project dependencies, kept separate so the
 * geometry and vector modules can use them without importing the raster pipeline
 * (which in turn depends on geometry).
 */

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
	blob: Blob,
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
			'image/png',
		),
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
