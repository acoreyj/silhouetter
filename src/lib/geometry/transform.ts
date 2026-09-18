import type { Layer, Point } from '$lib/types';

/** Scale polygons (in source pixel space) to millimetres within a layer box. */
export function polygonsToMm(
	polygons: Point[][],
	sourceWidth: number,
	sourceHeight: number,
	layer: Layer,
): Point[][] {
	const sx = layer.width / sourceWidth;
	const sy = layer.height / sourceHeight;
	return polygons.map((poly) => poly.map((p) => ({ x: p.x * sx, y: p.y * sy })));
}

/**
 * Convert polygons expressed in layer-local millimetres into absolute page
 * millimetres, applying the layer's rotation around its centre.
 */
export function transformPolygonsToPage(polygons: Point[][], layer: Layer): Point[][] {
	const cx = layer.x + layer.width / 2;
	const cy = layer.y + layer.height / 2;
	const rad = (layer.rotation * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	return polygons.map((poly) =>
		poly.map((p) => {
			const dx = p.x - layer.width / 2;
			const dy = p.y - layer.height / 2;
			return {
				x: cx + dx * cos - dy * sin,
				y: cy + dx * sin + dy * cos,
			};
		}),
	);
}

/**
 * Inverse of {@link transformPolygonsToPage}: map an absolute page-millimetre
 * point back into layer-local millimetres (undoing rotation about the centre).
 */
export function pagePointToLayerLocal(point: Point, layer: Layer): Point {
	const cx = layer.x + layer.width / 2;
	const cy = layer.y + layer.height / 2;
	const rad = (-layer.rotation * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	const dx = point.x - cx;
	const dy = point.y - cy;
	return {
		x: layer.width / 2 + dx * cos - dy * sin,
		y: layer.height / 2 + dx * sin + dy * cos,
	};
}

/** A layer transform paired with the pixel size of the bitmap it displays. */
export interface LayerPixelFrame {
	layer: Layer;
	pixelWidth: number;
	pixelHeight: number;
}

/** 2D affine matrix: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix2D = [number, number, number, number, number, number];

function multiply(m: Matrix2D, n: Matrix2D): Matrix2D {
	return [
		m[0] * n[0] + m[2] * n[1],
		m[1] * n[0] + m[3] * n[1],
		m[0] * n[2] + m[2] * n[3],
		m[1] * n[2] + m[3] * n[3],
		m[0] * n[4] + m[2] * n[5] + m[4],
		m[1] * n[4] + m[3] * n[5] + m[5],
	];
}

const translation = (x: number, y: number): Matrix2D => [1, 0, 0, 1, x, y];
const rotation = (rad: number): Matrix2D => {
	const c = Math.cos(rad);
	const s = Math.sin(rad);
	return [c, s, -s, c, 0, 0];
};
const scaling = (sx: number, sy: number): Matrix2D => [sx, 0, 0, sy, 0, 0];

/**
 * Matrix mapping pixels of one layer's bitmap into the pixel space of another
 * layer's bitmap, going through page millimetres so each layer's position,
 * scale and rotation are honoured.
 */
export function mapPixelSpace(from: LayerPixelFrame, to: LayerPixelFrame): Matrix2D {
	const a = scaling(from.layer.width / from.pixelWidth, from.layer.height / from.pixelHeight);
	const b = multiply(
		multiply(
			translation(from.layer.x + from.layer.width / 2, from.layer.y + from.layer.height / 2),
			rotation((from.layer.rotation * Math.PI) / 180),
		),
		translation(-from.layer.width / 2, -from.layer.height / 2),
	);
	const c = multiply(
		multiply(
			translation(to.layer.width / 2, to.layer.height / 2),
			rotation((-to.layer.rotation * Math.PI) / 180),
		),
		translation(-(to.layer.x + to.layer.width / 2), -(to.layer.y + to.layer.height / 2)),
	);
	const d = scaling(to.pixelWidth / to.layer.width, to.pixelHeight / to.layer.height);
	return multiply(multiply(multiply(d, c), b), a);
}

/**
 * Draw `image` (bitmap of `from`) into a context whose user space is `to`'s
 * bitmap pixel space, preserving the on-page alignment of the two layers.
 */
export function drawInPixelSpace(
	ctx: CanvasRenderingContext2D,
	image: CanvasImageSource,
	from: LayerPixelFrame,
	to: LayerPixelFrame,
): void {
	const t = mapPixelSpace(from, to);
	ctx.save();
	ctx.setTransform(t[0], t[1], t[2], t[3], t[4], t[5]);
	ctx.drawImage(image, 0, 0);
	ctx.restore();
}
