import type { DocumentModel, Point, SubjectLayer } from '$lib/types';
import { buildSubjectOutline, buildTrimPolygons } from '$lib/geometry/shape';

/**
 * Build a single subject layer's cut outline in page (trim) millimetres.
 *
 * The traced polygons are smoothed to remove sharp, jagged corners and then
 * expanded outwards so the cut clears the artwork. Smoothing runs first so the
 * expansion guarantees the final clearance.
 */
export function buildCutPolygons(layer: SubjectLayer, source: HTMLImageElement): Point[][] {
	return buildSubjectOutline(layer, source);
}

/**
 * Collect the cut outline a cutter should follow, in page (trim) millimetres.
 *
 * For a bookmark trim the cut is the whole silhouette (plain base unioned with
 * the head outline). For a rectangular trim every visible subject layer
 * contributes its own outline.
 */
export function collectCutPolygons(
	doc: DocumentModel,
	getSource: (id: string) => HTMLImageElement | undefined,
): Point[][] {
	if (doc.trimShape === 'bookmark') return buildTrimPolygons(doc, getSource);

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
export function shiftPolygons(polygons: Point[][], dx: number, dy: number): Point[][] {
	return polygons.map((poly) => poly.map((p) => ({ x: p.x + dx, y: p.y + dy })));
}
