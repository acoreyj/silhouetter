import { describe, expect, it } from 'vitest';
import { MM_PER_INCH, PT_PER_INCH, clamp, mmToPt, mmToPx, ptToMm, pxToMm, round } from './units';

describe('unit conversions', () => {
	it('converts millimetres to points', () => {
		expect(mmToPt(25.4)).toBeCloseTo(PT_PER_INCH, 9);
		expect(mmToPt(1)).toBeCloseTo(72 / 25.4, 9);
	});

	it('round-trips points and millimetres', () => {
		expect(ptToMm(mmToPt(42))).toBeCloseTo(42, 9);
	});

	it('converts millimetres to pixels at a DPI', () => {
		expect(mmToPx(MM_PER_INCH, 300)).toBeCloseTo(300, 9);
		expect(pxToMm(300, 300)).toBeCloseTo(MM_PER_INCH, 9);
		expect(mmToPx(1, 96)).toBeCloseTo(96 / 25.4, 9);
	});

	it('rounds and clamps', () => {
		expect(round(1.23456, 2)).toBe(1.23);
		expect(clamp(5, 0, 3)).toBe(3);
		expect(clamp(-1, 0, 3)).toBe(0);
	});
});
