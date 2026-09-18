import { clamp } from '$lib/units';
import type { Point } from '$lib/types';

/**
 * One pass of Chaikin corner cutting on a closed ring. Each edge is replaced by
 * two points at 1/4 and 3/4, which rounds every corner without moving the
 * overall shape much.
 */
function chaikin(ring: Point[]): Point[] {
	const n = ring.length;
	const out: Point[] = new Array(n * 2);
	for (let i = 0; i < n; i++) {
		const p = ring[i];
		const q = ring[(i + 1) % n];
		out[i * 2] = { x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 };
		out[i * 2 + 1] = { x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 };
	}
	return out;
}

/** Keep every `stride`-th point to bound the output size. */
function decimate(ring: Point[], maxPoints: number): Point[] {
	const stride = Math.ceil(ring.length / maxPoints);
	if (stride <= 1) return ring;
	const out: Point[] = [];
	for (let i = 0; i < ring.length; i += stride) out.push(ring[i]);
	return out;
}

/**
 * Smooth closed polygons to remove sharp, jagged corners from a traced
 * silhouette. `amount` is 0 (unchanged) to 1 (heavily rounded). Point counts are
 * capped so the preview and exporters stay responsive.
 */
export function smoothPolygons(
	polygons: Point[][],
	amount: number,
	maxPointsPerRing = 4000,
): Point[][] {
	const a = clamp(amount, 0, 1);
	if (a < 0.05) return polygons;
	const iterations = a < 0.4 ? 1 : a < 0.75 ? 2 : 3;

	return polygons.map((ring) => {
		if (ring.length < 4) return ring;
		let pts = ring;
		for (let i = 0; i < iterations; i++) pts = chaikin(pts);
		if (pts.length > maxPointsPerRing) pts = decimate(pts, maxPointsPerRing);
		return pts;
	});
}
