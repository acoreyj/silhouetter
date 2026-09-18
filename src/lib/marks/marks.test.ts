import { describe, expect, it } from 'vite-plus/test';
import { buildMarkSet, computeMedia, markSetToPath } from './index';
import { createDefaultDocument } from '$lib/doc.svelte';
import type { DocumentModel } from '$lib/types';

function docWith(patch: Partial<DocumentModel>): DocumentModel {
	return { ...createDefaultDocument(), ...patch };
}

describe('buildMarkSet', () => {
	it('produces four crosses for the generic style', () => {
		const doc = docWith({
			registration: { ...createDefaultDocument().registration, style: 'generic' },
		});
		const marks = buildMarkSet(doc);
		// Each cross is two lines.
		expect(marks.primitives).toHaveLength(8);
		expect(marks.bounds.x).toBeLessThan(0);
		expect(marks.bounds.y).toBeLessThan(0);
	});

	it('produces eight arms for the silhouette style', () => {
		const doc = docWith({
			registration: { ...createDefaultDocument().registration, style: 'silhouette' },
		});
		const marks = buildMarkSet(doc);
		expect(marks.primitives).toHaveLength(8);
	});

	it('produces a sensor rectangle plus brackets for cricut', () => {
		const doc = docWith({
			registration: { ...createDefaultDocument().registration, style: 'cricut' },
		});
		const marks = buildMarkSet(doc);
		expect(marks.primitives).toHaveLength(9);
	});

	it('produces nothing when disabled', () => {
		const doc = docWith({
			registration: { ...createDefaultDocument().registration, style: 'none' },
		});
		expect(buildMarkSet(doc).primitives).toHaveLength(0);
	});
});

describe('computeMedia', () => {
	it('expands the media to include marks outside the trim', () => {
		const doc = docWith({
			page: { width: 50, height: 150 },
			bleed: { enabled: true, amountMm: 3, mode: 'mirror', solidColor: '#fff' },
			registration: {
				...createDefaultDocument().registration,
				style: 'generic',
				marginMm: 5,
				sizeMm: 5,
			},
		});
		const marks = buildMarkSet(doc);
		const media = computeMedia(doc, marks);
		// Crosshair extends 2.5mm beyond its centre, plus 5mm margin => 7.5mm.
		expect(media.trimX).toBeGreaterThanOrEqual(7.4);
		expect(media.widthMm).toBeCloseTo(50 + media.trimX * 2, 6);
		expect(media.heightMm).toBeGreaterThan(150);
	});

	it('uses only the bleed when there are no marks', () => {
		const doc = docWith({
			page: { width: 50, height: 150 },
			bleed: { enabled: true, amountMm: 3, mode: 'mirror', solidColor: '#fff' },
			registration: { ...createDefaultDocument().registration, style: 'none' },
		});
		const marks = buildMarkSet(doc);
		const media = computeMedia(doc, marks);
		expect(media.trimX).toBe(3);
		expect(media.widthMm).toBe(56);
		expect(media.heightMm).toBe(156);
	});
});

describe('markSetToPath', () => {
	it('emits a path with moves and closes for cricut', () => {
		const doc = docWith({
			registration: { ...createDefaultDocument().registration, style: 'cricut' },
		});
		const path = markSetToPath(buildMarkSet(doc));
		expect(path.startsWith('M ')).toBe(true);
		expect(path).toContain('Z');
		expect(path.split('M ').length - 1).toBe(9);
	});
});
