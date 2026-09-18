import type { Point } from '$lib/types';

/** Axis-aligned bounds of the space the slice line lives in, in pixels. */
export interface SliceBounds {
	width: number;
	height: number;
}

/**
 * Build a closed quad covering the half-plane on one side of the line through
 * `p0` and `p1`, expressed in the same coordinate space as the points.
 *
 * The quad is extended far enough (well past the layer's diagonal) that, once
 * rasterized into a mask bitmap, it behaves as an infinite half-plane. `side`
 * is `1` or `-1`; the two values select opposite sides, so the editor's Flip
 * control can toggle which half is removed.
 */
export function halfPlanePolygon(
	p0: Point,
	p1: Point,
	side: number,
	bounds: SliceBounds,
): Point[] {
	const dx = p1.x - p0.x;
	const dy = p1.y - p0.y;
	const length = Math.hypot(dx, dy);
	if (length === 0) return [];
	const ux = dx / length;
	const uy = dy / length;
	// Unit normal. `side` flips it so the quad covers the opposite half-plane.
	const sign = side >= 0 ? 1 : -1;
	const nx = uy * sign;
	const ny = -ux * sign;
	// Comfortably longer than the layer diagonal. The segment is extended along
	// its own direction too, so a short line still slices the whole layer.
	const reach = 2 * (bounds.width + bounds.height);
	const a = { x: p0.x - ux * reach, y: p0.y - uy * reach };
	const b = { x: p1.x + ux * reach, y: p1.y + uy * reach };
	return [
		a,
		b,
		{ x: b.x + nx * reach, y: b.y + ny * reach },
		{ x: a.x + nx * reach, y: a.y + ny * reach },
	];
}

/**
 * Constrain `p1` to the nearest 45° direction from `p0`, preserving its
 * distance. Used while the Shift key is held so horizontal / vertical cuts
 * come out perfectly straight.
 */
export function snapLine(p0: Point, p1: Point): Point {
	const dx = p1.x - p0.x;
	const dy = p1.y - p0.y;
	const length = Math.hypot(dx, dy);
	if (length === 0) return p1;
	const step = Math.PI / 4;
	const angle = Math.round(Math.atan2(dy, dx) / step) * step;
	return { x: p0.x + Math.cos(angle) * length, y: p0.y + Math.sin(angle) * length };
}
