import type { BookmarkConfig, DocumentModel, Point, Rect, Size, SubjectLayer } from '$lib/types';
import { clamp } from '$lib/units';
import { smoothPolygons } from '$lib/vector/smooth';
import { intersectPolygons, offsetPolygons, unionPolygons } from '$lib/vector/trace';
import { polygonsToMm, transformPolygonsToPage } from './transform';

/**
 * Build a subject layer's cut outline in page (trim) millimetres: source pixels
 * are scaled into the layer box, smoothed to round jagged corners, expanded so
 * the cut clears the artwork, then rotated/translated onto the page.
 *
 * This is the single outline pipeline used by both the cut-line preview and the
 * bookmark trim shape.
 */
export function buildSubjectOutline(
	layer: SubjectLayer,
	source: { naturalWidth: number; naturalHeight: number },
): Point[][] {
	if (layer.cutPolygons.length === 0) return [];
	const local = polygonsToMm(layer.cutPolygons, source.naturalWidth, source.naturalHeight, layer);
	const smoothed = smoothPolygons(local, layer.cutSmooth ?? 0);
	const expanded = offsetPolygons(smoothed, Math.max(0, layer.cutExpandMm ?? 0), {
		jointType: 'jtRound',
		precision: 0.02,
	});
	return transformPolygonsToPage(expanded, layer);
}

/** Remove consecutive duplicate points from a ring. */
function dedupeRing(ring: Point[], epsilon = 0.001): Point[] {
	const out: Point[] = [];
	for (const p of ring) {
		const last = out[out.length - 1];
		if (!last || Math.abs(last.x - p.x) > epsilon || Math.abs(last.y - p.y) > epsilon) {
			out.push(p);
		}
	}
	const first = out[0];
	const last = out[out.length - 1];
	if (
		out.length > 2 &&
		Math.abs(first.x - last.x) <= epsilon &&
		Math.abs(first.y - last.y) <= epsilon
	) {
		out.pop();
	}
	return out;
}

/** Points along a circular arc, inclusive of both endpoints. */
function arcPoints(
	cx: number,
	cy: number,
	r: number,
	startAngle: number,
	endAngle: number,
	segments: number,
): Point[] {
	const out: Point[] = [];
	for (let i = 0; i <= segments; i++) {
		const a = startAngle + ((endAngle - startAngle) * i) / segments;
		out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
	}
	return out;
}

/** The bounding rectangle of a page, as a closed ring. */
export function rectPolygon(size: Size): Point[] {
	return [
		{ x: 0, y: 0 },
		{ x: size.width, y: 0 },
		{ x: size.width, y: size.height },
		{ x: 0, y: size.height },
	];
}

/** Vertical position of the seam between the plain base and the head outline. */
export function bookmarkSeamY(page: Size, cfg: BookmarkConfig): number {
	return page.height * (1 - clamp(cfg.baseFraction, 0.05, 0.95));
}

/**
 * Build the plain bookmark base: a rectangle from the seam down to the bottom,
 * with an optional V-notch in the bottom edge and independently rounded top and
 * bottom corners.
 */
export function bookmarkBasePolygon(
	page: Size,
	cfg: BookmarkConfig,
	seamY = bookmarkSeamY(page, cfg),
): Point[] {
	const w = page.width;
	const h = page.height;
	const baseHeight = Math.max(0, h - seamY);
	const depth = clamp(cfg.notchDepthMm ?? 0, 0, baseHeight * 0.9);
	const notchHalf = depth > 0 ? Math.min(depth, w * 0.4) : 0;
	const radius = clamp(
		cfg.cornerRadiusMm ?? 0,
		0,
		Math.max(0, Math.min(w / 2 - notchHalf, baseHeight / 2)),
	);

	// The top corners round into the seam. Keep them clear of the bottom arcs
	// and of each other so the ring never self-intersects.
	const maxTopRadius = Math.max(0, Math.min(w, baseHeight - radius));
	let tl = clamp(cfg.cornerRadiusTopLeftMm ?? 0, 0, maxTopRadius);
	let tr = clamp(cfg.cornerRadiusTopRightMm ?? 0, 0, maxTopRadius);
	if (tl + tr > w) {
		const scale = w / (tl + tr);
		tl *= scale;
		tr *= scale;
	}

	const pts: Point[] = [];

	if (tl > 0) {
		pts.push({ x: 0, y: seamY + tl });
		pts.push(...arcPoints(tl, seamY + tl, tl, Math.PI, 1.5 * Math.PI, 8).slice(1));
	} else {
		pts.push({ x: 0, y: seamY });
	}

	if (tr > 0) {
		pts.push({ x: w - tr, y: seamY });
		pts.push(...arcPoints(w - tr, seamY + tr, tr, -Math.PI / 2, 0, 8).slice(1));
	} else {
		pts.push({ x: w, y: seamY });
	}

	if (radius > 0) {
		pts.push({ x: w, y: h - radius });
		pts.push(...arcPoints(w - radius, h - radius, radius, 0, Math.PI / 2, 8).slice(1));
	} else {
		pts.push({ x: w, y: h });
	}

	if (notchHalf > 0) {
		pts.push({ x: w / 2 + notchHalf, y: h });
		pts.push({ x: w / 2, y: h - depth });
		pts.push({ x: w / 2 - notchHalf, y: h });
	}

	if (radius > 0) {
		pts.push({ x: radius, y: h });
		pts.push(...arcPoints(radius, h - radius, radius, Math.PI / 2, Math.PI, 8).slice(1));
	} else {
		pts.push({ x: 0, y: h });
	}

	return dedupeRing(pts);
}

/** Find the subject layer that supplies the top of a bookmark shape. */
export function bookmarkSubjectLayer(doc: DocumentModel): SubjectLayer | undefined {
	const byId = doc.bookmark.subjectLayerId
		? doc.layers.find(
				(l): l is SubjectLayer => l.id === doc.bookmark.subjectLayerId && l.kind === 'subject',
			)
		: undefined;
	if (byId) return byId;
	return doc.layers.find((l): l is SubjectLayer => l.kind === 'subject' && l.visible);
}

/**
 * Compute the document's overall trim outline in page (trim) millimetres.
 *
 * - `rect`: the page box.
 * - `bookmark`: the union of the plain bookmark base (bottom `baseFraction`) and
 *   the subject layer's expanded/smoothed outline clipped to the top band.
 *
 * Falls back to the plain base when there is no usable subject outline, so the
 * editor always has a shape to render.
 */
export function buildTrimPolygons(
	doc: DocumentModel,
	getSource: (id: string) => HTMLImageElement | undefined,
): Point[][] {
	if (doc.trimShape !== 'bookmark') return [rectPolygon(doc.page)];

	const seamY = bookmarkSeamY(doc.page, doc.bookmark);
	const base = [bookmarkBasePolygon(doc.page, doc.bookmark, seamY)];

	const subject = bookmarkSubjectLayer(doc);
	if (!subject) return base;
	const source = getSource(subject.sourceId);
	if (!source) return base;

	const head = buildSubjectOutline(subject, source);
	if (head.length === 0) return base;

	// The head band follows the subject outline and may poke out beyond the page
	// box by `headOverflowMm`, but is still cut off at the seam where the plain
	// base takes over. A zero overflow reproduces the old page-clipped behaviour.
	const overflow = Math.max(0, doc.bookmark.headOverflowMm ?? 0);
	const topBand = [
		[
			{ x: -overflow, y: -overflow },
			{ x: doc.page.width + overflow, y: -overflow },
			{ x: doc.page.width + overflow, y: seamY },
			{ x: -overflow, y: seamY },
		],
	];
	const headTop = intersectPolygons(head, topBand);
	if (headTop.length === 0) return base;

	const combined = unionPolygons(base, headTop);
	return combined.length ? combined : base;
}

/** Axis-aligned bounding box of a set of rings, or null when empty. */
export function polygonsBounds(polygons: Point[][]): Rect | null {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let seen = false;
	for (const ring of polygons) {
		for (const p of ring) {
			seen = true;
			minX = Math.min(minX, p.x);
			minY = Math.min(minY, p.y);
			maxX = Math.max(maxX, p.x);
			maxY = Math.max(maxY, p.y);
		}
	}
	if (!seen) return null;
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** True when the bookmark shape's head outline actually reaches the seam. */
export function bookmarkHasHeadCoverage(
	doc: DocumentModel,
	getSource: (id: string) => HTMLImageElement | undefined,
): boolean {
	if (doc.trimShape !== 'bookmark') return true;
	const subject = bookmarkSubjectLayer(doc);
	if (!subject) return false;
	const source = getSource(subject.sourceId);
	if (!source) return false;
	return buildSubjectOutline(subject, source).length > 0;
}
