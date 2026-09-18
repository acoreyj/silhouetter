import { describe, expect, it } from 'vite-plus/test';
import { DEFAULT_GUTTER_MM, imposeSheet, sheetSizeFor, SHEET_PRESETS } from './impose';

const a4 = sheetSizeFor('a4-landscape');

describe('sheetSizeFor', () => {
	it('returns landscape dimensions for A4', () => {
		expect(a4).toEqual({ widthMm: 297, heightMm: 210 });
	});

	it('lists A4 and US Letter presets', () => {
		expect(SHEET_PRESETS.map((p) => p.value)).toEqual(['a4-landscape', 'letter-landscape']);
	});
});

describe('imposeSheet', () => {
	it('centres three copies with a gutter on A4 landscape', () => {
		const result = imposeSheet({
			sheet: a4,
			item: { widthMm: 66, heightMm: 166 },
			copies: 3,
			marginMm: 5,
			gutterMm: DEFAULT_GUTTER_MM,
		});

		expect(result.fits).toBe(true);
		expect(result.group.width).toBeCloseTo(3 * 66 + 2 * DEFAULT_GUTTER_MM, 6);
		expect(result.group.x).toBeCloseTo((297 - 206) / 2, 6);
		expect(result.group.y).toBeCloseTo((210 - 166) / 2, 6);
		expect(result.placements.map((p) => p.x)).toEqual([
			result.group.x,
			result.group.x + 70,
			result.group.x + 140,
		]);
		expect(result.placements.every((p) => p.y === result.group.y)).toBe(true);
	});

	it('centres two copies without negative offsets', () => {
		const result = imposeSheet({
			sheet: a4,
			item: { widthMm: 66, heightMm: 166 },
			copies: 2,
			marginMm: 5,
		});
		expect(result.fits).toBe(true);
		expect(result.group.width).toBeCloseTo(2 * 66 + DEFAULT_GUTTER_MM, 6);
		expect(result.group.x).toBeCloseTo((297 - result.group.width) / 2, 6);
	});

	it('shrinks the gutter to fit before giving up', () => {
		const result = imposeSheet({
			sheet: a4,
			item: { widthMm: 140, heightMm: 100 },
			copies: 2,
			marginMm: 5,
			gutterMm: 20,
		});
		// Usable width is 287; two 140mm items only fit with a 7mm gutter.
		expect(result.fits).toBe(true);
		expect(result.group.width).toBeCloseTo(287, 6);
	});

	it('reports when copies plus the mark margin overflow', () => {
		const result = imposeSheet({
			sheet: a4,
			item: { widthMm: 150, heightMm: 200 },
			copies: 2,
			marginMm: 5,
		});
		expect(result.fits).toBe(false);
		expect(result.group.width).toBeGreaterThan(297 - 10);
	});

	it('reports when the item is too tall for the sheet', () => {
		const result = imposeSheet({
			sheet: a4,
			item: { widthMm: 40, heightMm: 205 },
			copies: 3,
			marginMm: 5,
		});
		expect(result.fits).toBe(false);
	});
});
