import { describe, expect, it } from 'vite-plus/test';
import { bookmarkBasePolygon, buildTrimPolygons, rectPolygon } from './shape';
import { createDefaultDocument } from '$lib/doc.svelte';
import type { DocumentModel, SubjectLayer } from '$lib/types';

const page = { width: 50, height: 150 };

function subject(patch: Partial<SubjectLayer> = {}): SubjectLayer {
	return {
		id: 'layer_1',
		kind: 'subject',
		name: 'Head',
		visible: true,
		locked: false,
		opacity: 1,
		x: 0,
		y: 0,
		width: 50,
		height: 50,
		rotation: 0,
		mirrorOnBack: true,
		sourceId: 'src_1',
		maskDataUrl: null,
		cutPolygons: [
			[
				{ x: 0, y: 0 },
				{ x: 50, y: 0 },
				{ x: 50, y: 50 },
				{ x: 0, y: 50 },
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

const source = { naturalWidth: 50, naturalHeight: 50 } as HTMLImageElement;
const getSource = () => source;

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

function bookmarkDoc(patch: Partial<DocumentModel> = {}): DocumentModel {
	const doc = createDefaultDocument();
	doc.page = page;
	doc.trimShape = 'bookmark';
	doc.bookmark = { ...doc.bookmark, baseFraction: 0.75, subjectLayerId: 'layer_1' };
	return { ...doc, ...patch };
}

describe('rectPolygon', () => {
	it('wraps the page box', () => {
		expect(rectPolygon(page)).toEqual([
			{ x: 0, y: 0 },
			{ x: 50, y: 0 },
			{ x: 50, y: 150 },
			{ x: 0, y: 150 },
		]);
	});
});

describe('bookmarkBasePolygon', () => {
	it('spans the seam to the bottom and cuts a centred notch', () => {
		const ring = bookmarkBasePolygon(page, {
			baseFraction: 0.75,
			subjectLayerId: null,
			notchDepthMm: 10,
			cornerRadiusMm: 0,
			cornerRadiusTopLeftMm: 0,
			cornerRadiusTopRightMm: 0,
			headOverflowMm: 0,
		});
		const b = bounds([ring]);
		expect(b.minY).toBeCloseTo(37.5, 3);
		expect(b.maxY).toBeCloseTo(150, 3);
		expect(b.minX).toBeCloseTo(0, 3);
		expect(b.maxX).toBeCloseTo(50, 3);
		// Notch tip sits `depth` above the bottom edge.
		expect(ring.some((p) => Math.abs(p.x - 25) < 1e-6 && Math.abs(p.y - 140) < 1e-6)).toBe(true);
	});

	it('leaves a flat bottom when the notch is disabled', () => {
		const ring = bookmarkBasePolygon(page, {
			baseFraction: 0.75,
			subjectLayerId: null,
			notchDepthMm: 0,
			cornerRadiusMm: 0,
			cornerRadiusTopLeftMm: 0,
			cornerRadiusTopRightMm: 0,
			headOverflowMm: 0,
		});
		expect(ring.every((p) => p.y <= 150.0001)).toBe(true);
		expect(ring.some((p) => Math.abs(p.y - 150) < 1e-6 && Math.abs(p.x - 25) < 1e-6)).toBe(false);
	});

	it('rounds the bottom corners inwards', () => {
		const ring = bookmarkBasePolygon(page, {
			baseFraction: 0.75,
			subjectLayerId: null,
			notchDepthMm: 0,
			cornerRadiusMm: 5,
			cornerRadiusTopLeftMm: 0,
			cornerRadiusTopRightMm: 0,
			headOverflowMm: 0,
		});
		expect(ring.length).toBeGreaterThan(4);
		// No point sits exactly on the square bottom corner.
		expect(ring.some((p) => Math.abs(p.x) < 1e-6 && Math.abs(p.y - 150) < 1e-6)).toBe(false);
	});

	it('rounds the top corners independently', () => {
		const ring = bookmarkBasePolygon(page, {
			baseFraction: 0.75,
			subjectLayerId: null,
			notchDepthMm: 0,
			cornerRadiusMm: 0,
			cornerRadiusTopLeftMm: 5,
			cornerRadiusTopRightMm: 8,
			headOverflowMm: 0,
		});
		const b = bounds([ring]);
		expect(b.minX).toBeCloseTo(0, 3);
		expect(b.maxX).toBeCloseTo(50, 3);
		expect(b.minY).toBeCloseTo(37.5, 3);
		// No point sits exactly on either square top corner.
		expect(ring.some((p) => Math.abs(p.x) < 1e-6 && Math.abs(p.y - 37.5) < 1e-6)).toBe(false);
		expect(ring.some((p) => Math.abs(p.x - 50) < 1e-6 && Math.abs(p.y - 37.5) < 1e-6)).toBe(false);
		// Each corner starts to round by its own radius.
		expect(ring.some((p) => Math.abs(p.x - 5) < 1e-6 && Math.abs(p.y - 37.5) < 1e-6)).toBe(true);
		expect(ring.some((p) => Math.abs(p.x - 42) < 1e-6 && Math.abs(p.y - 37.5) < 1e-6)).toBe(true);
	});
});

describe('buildTrimPolygons', () => {
	it('returns the page box for a rectangular trim', () => {
		const doc = createDefaultDocument();
		doc.page = page;
		const result = buildTrimPolygons(doc, getSource);
		const b = bounds(result);
		expect(b).toEqual({ minX: 0, maxX: 50, minY: 0, maxY: 150 });
	});

	it('unions the base with the head outline for a bookmark', () => {
		const doc = bookmarkDoc();
		doc.layers = [subject()];
		const b = bounds(buildTrimPolygons(doc, getSource));
		expect(b.minY).toBeCloseTo(0, 3);
		expect(b.maxY).toBeCloseTo(150, 3);
		expect(b.maxX).toBeCloseTo(50, 3);
	});

	it('falls back to the plain base when there is no subject', () => {
		const doc = bookmarkDoc();
		doc.layers = [];
		const b = bounds(buildTrimPolygons(doc, getSource));
		expect(b.minY).toBeCloseTo(37.5, 3);
		expect(b.maxY).toBeCloseTo(150, 3);
	});
});
