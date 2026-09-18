/**
 * Colour-based flood selection behind the magic eraser. Kept free of canvas and
 * DOM dependencies so it can be unit tested directly.
 */
import type { Point } from '$lib/types';

export interface FloodSelectOptions {
	/**
	 * Maximum Euclidean RGB distance (0-255 per channel) a pixel may differ from
	 * the seed colour and still be selected. Larger values erase more.
	 */
	tolerance?: number;
	/**
	 * Optional 1/0 mask restricting the flood to pixels that may be traversed
	 * (e.g. only pixels currently kept in the subject mask). Prevents a region
	 * leaking through transparent gaps into unrelated parts of the image.
	 */
	within?: Uint8Array;
}

export interface FloodRegion {
	/** 1 = selected, 0 = not, row-major, `width * height` long. */
	mask: Uint8Array;
	width: number;
	height: number;
	/** Half-open bounds of the selected pixels (min inclusive, max exclusive). */
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
	count: number;
}

/**
 * Select the 4-connected region of pixels whose RGB colour is within `tolerance`
 * of the pixel at `seed` (a magic-wand style flood fill). When `within` is
 * given, traversal is limited to allowed pixels. Returns `undefined` when the
 * seed lies outside the image or outside the allowed region.
 */
export function floodSelect(
	data: Uint8ClampedArray,
	width: number,
	height: number,
	seed: Point,
	{ tolerance = 32, within }: FloodSelectOptions = {},
): FloodRegion | undefined {
	if (width <= 0 || height <= 0) return undefined;
	const sx = Math.floor(seed.x);
	const sy = Math.floor(seed.y);
	if (sx < 0 || sy < 0 || sx >= width || sy >= height) return undefined;
	if (within && !within[sy * width + sx]) return undefined;

	const seedIndex = (sy * width + sx) * 4;
	const sr = data[seedIndex];
	const sg = data[seedIndex + 1];
	const sb = data[seedIndex + 2];
	const toleranceSq = tolerance * tolerance;

	const mask = new Uint8Array(width * height);
	const stack = new Int32Array(width * height);
	const start = sy * width + sx;
	mask[start] = 1;
	let top = 0;
	stack[top++] = start;

	let count = 0;
	let minX = sx;
	let minY = sy;
	let maxX = sx + 1;
	let maxY = sy + 1;

	while (top > 0) {
		const pixel = stack[--top];
		const y = (pixel / width) | 0;
		const x = pixel - y * width;
		count++;
		if (x < minX) minX = x;
		if (x >= maxX) maxX = x + 1;
		if (y < minY) minY = y;
		if (y >= maxY) maxY = y + 1;

		if (
			x > 0 &&
			!mask[pixel - 1] &&
			(!within || within[pixel - 1]) &&
			matches(data, pixel - 1, sr, sg, sb, toleranceSq)
		) {
			mask[pixel - 1] = 1;
			stack[top++] = pixel - 1;
		}
		if (
			x + 1 < width &&
			!mask[pixel + 1] &&
			(!within || within[pixel + 1]) &&
			matches(data, pixel + 1, sr, sg, sb, toleranceSq)
		) {
			mask[pixel + 1] = 1;
			stack[top++] = pixel + 1;
		}
		if (
			y > 0 &&
			!mask[pixel - width] &&
			(!within || within[pixel - width]) &&
			matches(data, pixel - width, sr, sg, sb, toleranceSq)
		) {
			mask[pixel - width] = 1;
			stack[top++] = pixel - width;
		}
		if (
			y + 1 < height &&
			!mask[pixel + width] &&
			(!within || within[pixel + width]) &&
			matches(data, pixel + width, sr, sg, sb, toleranceSq)
		) {
			mask[pixel + width] = 1;
			stack[top++] = pixel + width;
		}
	}

	return { mask, width, height, minX, minY, maxX, maxY, count };
}

function matches(
	data: Uint8ClampedArray,
	pixel: number,
	sr: number,
	sg: number,
	sb: number,
	toleranceSq: number,
): boolean {
	const i = pixel * 4;
	const dr = data[i] - sr;
	const dg = data[i + 1] - sg;
	const db = data[i + 2] - sb;
	return dr * dr + dg * dg + db * db <= toleranceSq;
}
