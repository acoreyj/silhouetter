import { traceImageData, type TurnPolicy } from '@cadit-app/potrace-ts';
import Shape from '@doodle3d/clipper-js';
import { get2d, type Canvas2D } from '$lib/image/ops';
import type { Point } from '$lib/types';

export interface TraceOptions {
	/** Suppress speckles smaller than this many pixels. */
	turdsize?: number;
	/** Corner threshold; 0 = very smooth, 1.334 = sharp corners. */
	alphamax?: number;
	/** Enable Bezier curve optimization. */
	optcurve?: boolean;
	/** Luminance threshold (0-255) separating subject from background. */
	threshold?: number;
	turnpolicy?: TurnPolicy;
}

/** Remove consecutive duplicate points from a polygon. */
function dedupe(points: Point[], epsilon = 0.01): Point[] {
	const out: Point[] = [];
	for (const p of points) {
		const last = out[out.length - 1];
		if (!last || Math.abs(last.x - p.x) > epsilon || Math.abs(last.y - p.y) > epsilon) {
			out.push(p);
		}
	}
	// Close the ring if the trace did not repeat the first point.
	if (out.length > 2) {
		const first = out[0];
		const last = out[out.length - 1];
		if (Math.abs(first.x - last.x) <= epsilon && Math.abs(first.y - last.y) <= epsilon) {
			out.pop();
		}
	}
	return out;
}

/**
 * Trace a binary mask (opaque subject over transparency) into closed polygons
 * in the mask's pixel coordinate space.
 */
export function traceMask(mask: Canvas2D, options: TraceOptions = {}): Point[][] {
	const ctx = get2d(mask, true);
	const imageData = ctx.getImageData(0, 0, mask.width, mask.height);
	const paths = traceImageData(
		imageData,
		{
			turdsize: options.turdsize ?? 8,
			alphamax: options.alphamax ?? 1.334,
			optcurve: options.optcurve ?? true,
			turnpolicy: options.turnpolicy ?? 'minority',
			opttolerance: 0.2
		},
		options.threshold ?? 128
	);
	return paths
		.map((path) => dedupe(path.points.map((p) => ({ x: p.x, y: p.y }))))
		.filter((poly) => poly.length >= 3);
}

export interface OffsetOptions {
	jointType?: 'jtRound' | 'jtSquare' | 'jtMiter';
	/** Arc tolerance in input units (pixels). */
	precision?: number;
}

/**
 * Offset (dilate) closed polygons by `delta` input units. Positive deltas grow
 * the shape outwards and shrink holes, which is what a cut line needs.
 */
export function offsetPolygons(
	polygons: Point[][],
	delta: number,
	options: OffsetOptions = {}
): Point[][] {
	if (polygons.length === 0 || delta === 0) return polygons;

	// Clipper works with integers, so scale up for sub-unit precision.
	const scale = 100;
	const shape = new Shape(
		polygons.map((poly) => poly.map((p) => ({ x: p.x, y: p.y }))),
		true,
		true,
		false,
		true
	);
	shape.scaleUp(scale);
	const offset = shape.offset(delta * scale, {
		jointType: options.jointType ?? 'jtRound',
		endType: 'etClosedPolygon',
		roundPrecision: (options.precision ?? 0.05) * scale
	});
	offset.scaleDown(scale);

	return offset
		.mapToLower()
		.map((poly) => dedupe(poly.map((p) => ({ x: p.x, y: p.y }))))
		.filter((poly) => poly.length >= 3);
}

/** Serialise closed polygons as an SVG path (M/L/Z), optionally transformed. */
export function polygonsToSvgPath(
	polygons: Point[][],
	decimals = 3,
	transform?: (p: Point) => Point
): string {
	const fmt = (n: number) => {
		const v = Number(n.toFixed(decimals));
		return Number.isInteger(v) ? String(v) : v.toString();
	};
	const parts: string[] = [];
	for (const poly of polygons) {
		if (poly.length < 3) continue;
		const pts = transform ? poly.map(transform) : poly;
		parts.push(`M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`);
		for (let i = 1; i < pts.length; i++) {
			parts.push(`L ${fmt(pts[i].x)} ${fmt(pts[i].y)}`);
		}
		parts.push('Z');
	}
	return parts.join(' ');
}
