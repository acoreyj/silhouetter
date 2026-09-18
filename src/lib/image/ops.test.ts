import { describe, expect, it } from 'vite-plus/test';
import { cleanAlphaMask, DEFAULT_ALPHA_THRESHOLD, DEFAULT_MASK_ERODE_PX } from './ops';

/** Build an RGBA buffer where only the alpha channel matters. */
function rgba(width: number, height: number, alpha: number[]): Uint8ClampedArray {
	const data = new Uint8ClampedArray(width * height * 4);
	alpha.forEach((a, i) => {
		const p = i * 4;
		data[p] = 200;
		data[p + 1] = 100;
		data[p + 2] = 50;
		data[p + 3] = a;
	});
	return data;
}

function alphaOf(data: Uint8ClampedArray): number[] {
	const out: number[] = [];
	for (let i = 3; i < data.length; i += 4) out.push(data[i]);
	return out;
}

describe('cleanAlphaMask', () => {
	it('keeps pixels at or above the threshold and drops the rest', () => {
		const data = rgba(5, 1, [255, 127, 128, 8, 200]);
		cleanAlphaMask(data, 5, 1, { threshold: 128, erodePx: 0 });
		expect(alphaOf(data)).toEqual([255, 0, 255, 0, 255]);
	});

	it('writes kept pixels as opaque black', () => {
		const data = rgba(1, 1, [255]);
		cleanAlphaMask(data, 1, 1, { threshold: 128, erodePx: 0 });
		expect([...data]).toEqual([0, 0, 0, 255]);
	});

	it('erodes a solid block by one pixel on every side', () => {
		const data = rgba(3, 3, new Array(9).fill(255));
		cleanAlphaMask(data, 3, 3, { threshold: 128, erodePx: 1 });
		expect(alphaOf(data)).toEqual([0, 0, 0, 0, 255, 0, 0, 0, 0]);
	});

	it('severs a thin low-alpha bridge between two subject blocks', () => {
		// 9x3: solid blocks left and right, joined by a 1px-tall bridge. The
		// bridge models the low-alpha fringe that survives inside a tight gap.
		const width = 9;
		const height = 3;
		const alpha = new Array(width * height).fill(0);
		const set = (x: number, y: number, a: number) => (alpha[y * width + x] = a);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < 3; x++) set(x, y, 255);
			for (let x = 6; x < width; x++) set(x, y, 255);
		}
		for (let x = 3; x < 6; x++) set(x, 1, 255);

		const data = rgba(width, height, alpha);
		cleanAlphaMask(data, width, height, { threshold: 128, erodePx: 1 });
		const cleaned = alphaOf(data);
		for (let x = 3; x < 6; x++) {
			expect(cleaned[1 * width + x]).toBe(0);
		}
		expect(cleaned[1 * width + 1]).toBe(255);
		expect(cleaned[1 * width + 7]).toBe(255);
	});

	it('applies the default threshold and erosion', () => {
		expect(DEFAULT_ALPHA_THRESHOLD).toBe(128);
		expect(DEFAULT_MASK_ERODE_PX).toBe(1);

		const solid = rgba(5, 5, new Array(25).fill(255));
		cleanAlphaMask(solid, 5, 5);
		const alphas = alphaOf(solid);
		for (let y = 0; y < 5; y++) {
			for (let x = 0; x < 5; x++) {
				const edge = x === 0 || y === 0 || x === 4 || y === 4;
				expect(alphas[y * 5 + x]).toBe(edge ? 0 : 255);
			}
		}

		const faint = rgba(5, 5, new Array(25).fill(100));
		cleanAlphaMask(faint, 5, 5);
		expect(alphaOf(faint).every((a) => a === 0)).toBe(true);
	});
});
