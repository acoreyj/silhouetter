import { describe, expect, it } from 'vite-plus/test';
import { halfPlanePolygon, snapLine, type SliceBounds } from './slice';
import type { Point } from '$lib/types';

const bounds: SliceBounds = { width: 200, height: 100 };

/** Ray-casting point-in-polygon test for the (convex) slice quads. */
function inside(polygon: Point[], p: Point): boolean {
	let hit = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const a = polygon[i];
		const b = polygon[j];
		const crosses = a.y > p.y !== b.y > p.y;
		if (crosses && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
	}
	return hit;
}

describe('halfPlanePolygon', () => {
	it('covers the normal side of a horizontal line for side 1', () => {
		const quad = halfPlanePolygon({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, bounds);
		expect(quad).toHaveLength(4);
		expect(inside(quad, { x: 5, y: -5 })).toBe(true);
		expect(inside(quad, { x: 5, y: 5 })).toBe(false);
	});

	it('covers the opposite side for side -1', () => {
		const quad = halfPlanePolygon({ x: 0, y: 0 }, { x: 10, y: 0 }, -1, bounds);
		expect(inside(quad, { x: 5, y: 5 })).toBe(true);
		expect(inside(quad, { x: 5, y: -5 })).toBe(false);
	});

	it('reaches beyond every corner for a line in the middle', () => {
		const quad = halfPlanePolygon({ x: 100, y: 50 }, { x: 200, y: 50 }, 1, bounds);
		expect(inside(quad, { x: 0, y: 0 })).toBe(true);
		expect(inside(quad, { x: 200, y: 0 })).toBe(true);
	});

	it('returns no polygon for a degenerate line', () => {
		expect(halfPlanePolygon({ x: 3, y: 3 }, { x: 3, y: 3 }, 1, bounds)).toEqual([]);
	});
});

describe('snapLine', () => {
	it('snaps a near-horizontal line to horizontal', () => {
		const snapped = snapLine({ x: 0, y: 0 }, { x: 10, y: 1 });
		expect(snapped.y).toBeCloseTo(0);
		expect(snapped.x).toBeCloseTo(Math.hypot(10, 1));
	});

	it('snaps a near-vertical line to vertical', () => {
		const snapped = snapLine({ x: 0, y: 0 }, { x: 1, y: 10 });
		expect(snapped.x).toBeCloseTo(0);
		expect(snapped.y).toBeCloseTo(Math.hypot(1, 10));
	});

	it('leaves the start point untouched', () => {
		const snapped = snapLine({ x: 4, y: 7 }, { x: 9, y: 7 });
		expect(snapped).toEqual({ x: 9, y: 7 });
	});
});
