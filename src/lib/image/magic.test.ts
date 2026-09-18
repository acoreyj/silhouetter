import { describe, expect, it } from 'vite-plus/test';
import { floodSelect } from './magic';

/** Build an RGBA buffer from rows of [r, g, b] tuples (alpha is opaque). */
function rgba(rows: [number, number, number][][]): {
	data: Uint8ClampedArray;
	width: number;
	height: number;
} {
	const height = rows.length;
	const width = rows[0].length;
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const [r, g, b] = rows[y][x];
			const i = (y * width + x) * 4;
			data[i] = r;
			data[i + 1] = g;
			data[i + 2] = b;
			data[i + 3] = 255;
		}
	}
	return { data, width, height };
}

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

describe('floodSelect', () => {
	it('selects a connected run of the seed colour', () => {
		const { data, width, height } = rgba([
			[BLACK, WHITE, WHITE],
			[BLACK, WHITE, WHITE],
			[BLACK, BLACK, BLACK],
		]);
		const region = floodSelect(data, width, height, { x: 1, y: 0 }, { tolerance: 0 });
		expect(region?.count).toBe(4);
		expect(region && [...region.mask]).toEqual([0, 1, 1, 0, 1, 1, 0, 0, 0]);
		expect(region).toMatchObject({ minX: 1, minY: 0, maxX: 3, maxY: 2 });
	});

	it('does not leak across a colour barrier', () => {
		const { data, width, height } = rgba([
			[WHITE, BLACK, WHITE],
			[WHITE, BLACK, WHITE],
		]);
		const region = floodSelect(data, width, height, { x: 0, y: 0 }, { tolerance: 0 });
		expect(region?.count).toBe(2);
		expect(region?.mask[2]).toBe(0);
	});

	it('is 4-connected, so diagonals are separate regions', () => {
		const { data, width, height } = rgba([
			[WHITE, BLACK],
			[BLACK, WHITE],
		]);
		const region = floodSelect(data, width, height, { x: 0, y: 0 }, { tolerance: 0 });
		expect(region?.count).toBe(1);
		expect(region?.mask[3]).toBe(0);
	});

	it('includes colours within the tolerance', () => {
		const { data, width, height } = rgba([
			[WHITE, [240, 240, 240]],
			[[0, 0, 0], [0, 0, 0]],
		]);
		const near = floodSelect(data, width, height, { x: 0, y: 0 }, { tolerance: 32 });
		expect(near?.count).toBe(2);
		const exact = floodSelect(data, width, height, { x: 0, y: 0 }, { tolerance: 0 });
		expect(exact?.count).toBe(1);
	});

	it('returns undefined for a seed outside the image', () => {
		const { data, width, height } = rgba([[WHITE]]);
		expect(floodSelect(data, width, height, { x: 5, y: 0 })).toBeUndefined();
		expect(floodSelect(data, width, height, { x: -1, y: 0 })).toBeUndefined();
	});

	it('does not cross pixels excluded by the within mask', () => {
		const { data, width, height } = rgba([
			[WHITE, WHITE, WHITE, WHITE, WHITE],
			[WHITE, WHITE, WHITE, WHITE, WHITE],
		]);
		// Allow only the left two columns; the white to the right is unreachable.
		const within = new Uint8Array(width * height).fill(1);
		for (let y = 0; y < height; y++) {
			for (let x = 2; x < width; x++) within[y * width + x] = 0;
		}
		const region = floodSelect(data, width, height, { x: 0, y: 0 }, { within });
		expect(region?.count).toBe(4);
		expect(region?.maxX).toBe(2);
	});

	it('returns undefined when the seed is outside the within mask', () => {
		const { data, width, height } = rgba([[WHITE, WHITE]]);
		expect(floodSelect(data, width, height, { x: 1, y: 0 }, { within: new Uint8Array([1, 0]) }))
			.toBeUndefined();
	});
});
