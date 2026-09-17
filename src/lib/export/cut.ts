import type { DocumentModel, Point, SubjectLayer } from '$lib/types';
import { polygonsToMm, transformPolygonsToPage } from '$lib/image/ops';
import { offsetPolygons } from '$lib/vector/trace';
import { smoothPolygons } from '$lib/vector/smooth';

/**
 * Build a single subject layer's cut outline in page (trim) millimetres.
 *
 * The traced polygons are smoothed to remove sharp, jagged corners and then
 * expanded outwards so the cut clears the artwork. Smoothing runs first so the
 * expansion guarantees the final clearance.
 */
export function buildCutPolygons(layer: SubjectLayer, source: HTMLImageElement): Point[][] {
	if (layer.cutPolygons.length === 0) return [];
	const local = polygonsToMm(
		layer.cutPolygons,
		source.naturalWidth,
		source.naturalHeight,
		layer
	);
	const smoothed = smoothPolygons(local, layer.cutSmooth ?? 0);
	const expanded = offsetPolygons(smoothed, Math.max(0, layer.cutExpandMm ?? 0), {
		jointType: 'jtRound',
		precision: 0.02
	});
	return transformPolygonsToPage(expanded, layer);
}

/**
 * Collect every subject layer's cut outline, converted from source pixels to
 * page (trim) millimetres with the layer transform, smoothing and expansion
 * applied.
 */
export function collectCutPolygons(
	doc: DocumentModel,
	getSource: (id: string) => HTMLImageElement | undefined
): Point[][] {
	const out: Point[][] = [];
	for (const layer of doc.layers) {
		if (layer.kind !== 'subject' || !layer.visible) continue;
		if (layer.cutPolygons.length === 0) continue;
		const source = getSource(layer.sourceId);
		if (!source) continue;
		out.push(...buildCutPolygons(layer, source));
	}
	return out;
}

/** Shift page-coordinate points into media coordinates. */
export function shiftPolygons(
	polygons: Point[][],
	dx: number,
	dy: number
): Point[][] {
	return polygons.map((poly) => poly.map((p) => ({ x: p.x + dx, y: p.y + dy })));
}
