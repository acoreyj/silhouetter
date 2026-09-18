import { describe, expect, it } from 'vite-plus/test';
import {
	booleanPolygons,
	intersectPolygons,
	offsetPolygons,
	polygonsToSvgPath,
	unionPolygons,
} from './trace';

const square = [
	[
		{ x: 0, y: 0 },
		{ x: 10, y: 0 },
		{ x: 10, y: 10 },
		{ x: 0, y: 10 },
	],
];

function bounds(polys: { x: number; y: number }[][]) {
	const xs = polys.flat().map((p) => p.x);
	const ys = polys.flat().map((p) => p.y);
	return {
		minX: Math.min(...xs),
		maxX: Math.max(...xs),
		minY: Math.min(...ys),
		maxY: Math.max(...ys),
	};
}

describe('offsetPolygons', () => {
	it('grows a square outwards by the delta', () => {
		const result = offsetPolygons(square, 2);
		const b = bounds(result);
		expect(b.minX).toBeCloseTo(-2, 1);
		expect(b.maxX).toBeCloseTo(12, 1);
		expect(b.minY).toBeCloseTo(-2, 1);
		expect(b.maxY).toBeCloseTo(12, 1);
	});

	it('returns the input unchanged for a zero delta', () => {
		expect(offsetPolygons(square, 0)).toBe(square);
	});

	it('leaves an already-closed ring valid', () => {
		const result = offsetPolygons(square, 0.5);
		expect(result.length).toBeGreaterThanOrEqual(1);
		expect(result[0].length).toBeGreaterThanOrEqual(3);
	});
});

describe('booleanPolygons', () => {
	const a = [
		[
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
			{ x: 0, y: 10 },
		],
	];
	const b = [
		[
			{ x: 5, y: 5 },
			{ x: 15, y: 5 },
			{ x: 15, y: 15 },
			{ x: 5, y: 15 },
		],
	];

	it('unions overlapping squares into one ring', () => {
		const result = unionPolygons(a, b);
		expect(result).toHaveLength(1);
		const bb = bounds(result);
		expect(bb.minX).toBeCloseTo(0, 1);
		expect(bb.maxX).toBeCloseTo(15, 1);
	});

	it('intersects overlapping squares', () => {
		const result = intersectPolygons(a, b);
		const bb = bounds(result);
		expect(bb.minX).toBeCloseTo(5, 1);
		expect(bb.maxX).toBeCloseTo(10, 1);
	});

	it('returns empty when an intersecting set is empty', () => {
		expect(booleanPolygons(a, [], 'intersect')).toEqual([]);
	});

	it('keeps both inputs for a union with an empty set', () => {
		expect(booleanPolygons(a, [], 'union')).toHaveLength(1);
	});
});

describe('polygonsToSvgPath', () => {
	it('serialises polygons to a closed path', () => {
		const path = polygonsToSvgPath(square);
		expect(path).toBe('M 0 0 L 10 0 L 10 10 L 0 10 Z');
	});

	it('applies an optional transform', () => {
		const path = polygonsToSvgPath(square, 3, (p) => ({ x: p.x * 2, y: p.y * 2 }));
		expect(path).toBe('M 0 0 L 20 0 L 20 20 L 0 20 Z');
	});

	it('skips degenerate paths', () => {
		expect(polygonsToSvgPath([[{ x: 0, y: 0 }]])).toBe('');
	});
});
