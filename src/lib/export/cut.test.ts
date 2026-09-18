import { describe, expect, it } from 'vite-plus/test';
import { buildCutPolygons, collectCutPolygons } from './cut';
import { createDefaultDocument } from '$lib/doc.svelte';
import type { SubjectLayer } from '$lib/types';

function squareSubject(patch: Partial<SubjectLayer> = {}): SubjectLayer {
	return {
		id: 'layer_1',
		kind: 'subject',
		name: 'Subject',
		visible: true,
		locked: false,
		opacity: 1,
		x: 0,
		y: 0,
		width: 10,
		height: 10,
		rotation: 0,
		mirrorOnBack: true,
		sourceId: 'src_1',
		maskDataUrl: null,
		cutPolygons: [
			[
				{ x: 1, y: 1 },
				{ x: 9, y: 1 },
				{ x: 9, y: 9 },
				{ x: 1, y: 9 },
			],
		],
		cutExpandMm: 0,
		cutSmooth: 0,
		traceThreshold: 128,
		traceAutoThreshold: false,
		traceDespeckle: 8,
		maskStrokes: [],
		...patch,
	};
}

const source = { naturalWidth: 10, naturalHeight: 10 } as HTMLImageElement;

function bounds(polys: { x: number; y: number }[][]) {
	const xs = polys.flat().map((p) => p.x);
	const ys = polys.flat().map((p) => p.y);
	return { minX: Math.min(...xs), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

describe('buildCutPolygons', () => {
	it('maps source pixels to page millimetres', () => {
		const result = buildCutPolygons(squareSubject(), source);
		const b = bounds(result);
		expect(b.minX).toBeCloseTo(1, 1);
		expect(b.maxX).toBeCloseTo(9, 1);
	});

	it('expands the outline by the requested amount', () => {
		const result = buildCutPolygons(squareSubject({ cutExpandMm: 2 }), source);
		const b = bounds(result);
		expect(b.minX).toBeCloseTo(-1, 1);
		expect(b.maxX).toBeCloseTo(11, 1);
	});

	it('produces more points when smoothing is enabled', () => {
		const raw = buildCutPolygons(squareSubject(), source);
		const smooth = buildCutPolygons(squareSubject({ cutSmooth: 1 }), source);
		expect(smooth[0].length).toBeGreaterThan(raw[0].length);
	});

	it('returns nothing when there is no trace', () => {
		expect(buildCutPolygons(squareSubject({ cutPolygons: [] }), source)).toEqual([]);
	});

	it('collects every visible subject outline for a rectangular trim', () => {
		const doc = createDefaultDocument();
		doc.layers = [squareSubject()];
		const result = collectCutPolygons(doc, () => source);
		expect(result.length).toBeGreaterThanOrEqual(1);
	});

	it('collects the combined document shape for a bookmark trim', () => {
		const doc = createDefaultDocument();
		doc.page = { width: 10, height: 10 };
		doc.trimShape = 'bookmark';
		doc.bookmark = { ...doc.bookmark, baseFraction: 0.5, subjectLayerId: 'layer_1' };
		doc.layers = [
			squareSubject({
				width: 10,
				height: 10,
				cutPolygons: [
					[
						{ x: 0, y: 0 },
						{ x: 10, y: 0 },
						{ x: 10, y: 10 },
						{ x: 0, y: 10 },
					],
				],
			}),
		];
		const result = collectCutPolygons(doc, () => source);
		const ys = result.flat().map((p) => p.y);
		// The head outline reaches the top of the page and the base reaches the bottom.
		expect(Math.min(...ys)).toBeLessThan(0.5);
		expect(Math.max(...ys)).toBeCloseTo(10, 0);
	});
});
