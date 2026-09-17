import { describe, expect, it } from 'vitest';
import { smoothPolygons } from './smooth';
import type { Point } from '$lib/types';

const square: Point[] = [
	{ x: 0, y: 0 },
	{ x: 10, y: 0 },
	{ x: 10, y: 10 },
	{ x: 0, y: 10 }
];

describe('smoothPolygons', () => {
	it('returns the input untouched at zero amount', () => {
		const input = [square];
		expect(smoothPolygons(input, 0)).toBe(input);
		expect(smoothPolygons(input, 0.04)[0]).toBe(square);
	});

	it('adds points and rounds the corners', () => {
		const [smoothed] = smoothPolygons([square], 1);
		expect(smoothed.length).toBeGreaterThan(square.length);
		// Chaikin is a convex combination, so every point stays inside the box
		// and the exact square corners disappear.
		for (const p of smoothed) {
			expect(p.x).toBeGreaterThanOrEqual(-1e-9);
			expect(p.x).toBeLessThanOrEqual(10 + 1e-9);
			expect(p.y).toBeGreaterThanOrEqual(-1e-9);
			expect(p.y).toBeLessThanOrEqual(10 + 1e-9);
		}
		expect(smoothed.some((p) => p.x === 0 && p.y === 0)).toBe(false);
	});

	it('pulls in a sharp spike', () => {
		const spike: Point[] = [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
			{ x: 5, y: 50 },
			{ x: 0, y: 10 }
		];
		const maxBefore = Math.max(...spike.map((p) => p.y));
		const [smoothed] = smoothPolygons([spike], 1);
		const maxAfter = Math.max(...smoothed.map((p) => p.y));
		expect(maxAfter).toBeLessThan(maxBefore);
	});

	it('leaves degenerate rings alone', () => {
		const tiny: Point[] = [
			{ x: 0, y: 0 },
			{ x: 1, y: 1 }
		];
		expect(smoothPolygons([tiny], 1)[0]).toBe(tiny);
	});
});
