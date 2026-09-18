import type { DocumentModel, MarkStyle, Point, Rect } from '$lib/types';

/**
 * Registration marks are described as resolution-independent primitives in the
 * trim coordinate space: (0,0) is the top-left corner of the trim box, +x is
 * right and +y is down, all values in millimetres. Marks are allowed to fall
 * outside the trim box (into the bleed/margin), so exporters compute the media
 * size from {@link MarkSet.bounds}.
 */
export type MarkPrimitive =
	| { type: 'line'; x1: number; y1: number; x2: number; y2: number; width: number }
	| { type: 'rect'; x: number; y: number; width: number; height: number; strokeWidth: number }
	| { type: 'circle'; cx: number; cy: number; r: number; strokeWidth: number }
	| { type: 'polyline'; points: Point[]; width: number };

export interface MarkSet {
	primitives: MarkPrimitive[];
	/** Data Matrix payload to render alongside the marks, if requested. */
	dataMatrix: { x: number; y: number; size: number; value: string } | null;
	/** Extent relative to the trim box; may have negative origin. */
	bounds: Rect;
}

export const MARK_STYLES: { value: MarkStyle; label: string; description: string }[] = [
	{ value: 'none', label: 'None', description: 'No registration marks' },
	{
		value: 'silhouette',
		label: 'Silhouette',
		description: 'L-shaped corner brackets in the Silhouette Studio style',
	},
	{
		value: 'cricut',
		label: 'Cricut',
		description: 'Print-Then-Cut sensor rectangle and corner ticks',
	},
	{
		value: 'generic',
		label: 'Generic',
		description: 'Corner crosshair fiducials for GCC / Roland / other cutters',
	},
];

function boundsOf(primitives: MarkPrimitive[]): Rect {
	let minX = 0;
	let minY = 0;
	let maxX = 0;
	let maxY = 0;
	let first = true;

	const visit = (x: number, y: number) => {
		if (first) {
			minX = maxX = x;
			minY = maxY = y;
			first = false;
			return;
		}
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	};

	for (const p of primitives) {
		if (p.type === 'line') {
			visit(p.x1, p.y1);
			visit(p.x2, p.y2);
		} else if (p.type === 'rect') {
			visit(p.x, p.y);
			visit(p.x + p.width, p.y + p.height);
		} else if (p.type === 'circle') {
			visit(p.cx - p.r, p.cy - p.r);
			visit(p.cx + p.r, p.cy + p.r);
		} else {
			for (const pt of p.points) visit(pt.x, pt.y);
		}
	}

	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function cross(cx: number, cy: number, size: number, width: number): MarkPrimitive[] {
	const h = size / 2;
	return [
		{ type: 'line', x1: cx - h, y1: cy, x2: cx + h, y2: cy, width },
		{ type: 'line', x1: cx, y1: cy - h, x2: cx, y2: cy + h, width },
	];
}

/**
 * Build the four L-shaped corner brackets *outside* the trim box. The bracket
 * corner sits `margin` mm beyond the trim corner and its arms extend `size` mm
 * back towards the artwork.
 */
function cornerBrackets(
	w: number,
	h: number,
	margin: number,
	size: number,
	width: number,
): MarkPrimitive[] {
	const arms: MarkPrimitive[] = [];
	const corners: { x: number; y: number; sx: number; sy: number }[] = [
		{ x: -margin, y: -margin, sx: 1, sy: 1 },
		{ x: w + margin, y: -margin, sx: -1, sy: 1 },
		{ x: -margin, y: h + margin, sx: 1, sy: -1 },
		{ x: w + margin, y: h + margin, sx: -1, sy: -1 },
	];

	for (const c of corners) {
		arms.push({
			type: 'line',
			x1: c.x,
			y1: c.y,
			x2: c.x + size * c.sx,
			y2: c.y,
			width,
		});
		arms.push({
			type: 'line',
			x1: c.x,
			y1: c.y,
			x2: c.x,
			y2: c.y + size * c.sy,
			width,
		});
	}
	return arms;
}

/**
 * Build the registration mark set for a document.
 *
 * Notes on hardware support:
 * - Cricut's Design Space draws Print-Then-Cut sensor marks itself and warns
 *   that externally printed PDFs produce mis-sized marks. Prefer exporting the
 *   SVG and uploading it to Design Space.
 * - Silhouette Studio likewise controls its own marks for official Print & Cut.
 *   The brackets generated here are intended for alignment / third-party
 *   workflows and should be validated on real hardware.
 */
export function buildMarkSet(doc: DocumentModel): MarkSet {
	const { style, marginMm, sizeMm, lineWidthMm, dataMatrix, dataMatrixValue } = doc.registration;
	const w = doc.page.width;
	const h = doc.page.height;
	const primitives: MarkPrimitive[] = [];

	if (style === 'silhouette') {
		// Corner brackets sitting in the margin outside the trim box.
		primitives.push(...cornerBrackets(w, h, marginMm, sizeMm, lineWidthMm));
	} else if (style === 'cricut') {
		// Sensor rectangle surrounding the design with short corner ticks.
		const m = marginMm;
		primitives.push({
			type: 'rect',
			x: -m,
			y: -m,
			width: w + m * 2,
			height: h + m * 2,
			strokeWidth: lineWidthMm,
		});
		primitives.push(...cornerBrackets(w, h, m, sizeMm, lineWidthMm));
	} else if (style === 'generic') {
		const c = sizeMm;
		primitives.push(...cross(-marginMm, -marginMm, c, lineWidthMm));
		primitives.push(...cross(w + marginMm, -marginMm, c, lineWidthMm));
		primitives.push(...cross(-marginMm, h + marginMm, c, lineWidthMm));
		primitives.push(...cross(w + marginMm, h + marginMm, c, lineWidthMm));
	}

	const bounds = primitives.length ? boundsOf(primitives) : { x: 0, y: 0, width: w, height: h };

	let dm: MarkSet['dataMatrix'] = null;
	if (style !== 'none' && dataMatrix && dataMatrixValue) {
		const dmSize = sizeMm * 2;
		dm = {
			x: -marginMm,
			y: h + marginMm,
			size: dmSize,
			value: dataMatrixValue,
		};
		bounds.y = Math.min(bounds.y, dm.y);
		bounds.x = Math.min(bounds.x, dm.x);
		bounds.height = Math.max(bounds.height, dm.y + dmSize - bounds.y);
		bounds.width = Math.max(bounds.width, dm.x + dmSize - bounds.x);
	}

	return { primitives, dataMatrix: dm, bounds };
}

/**
 * Compute the physical media box needed to hold the trim area, bleed and any
 * registration marks. `contentBounds` is the page-millimetre bounding box of the
 * document's trim outline (which may extend beyond the page for a bookmark whose
 * head overflows); pass it so the media grows to include the silhouette.
 * Returns the media size in mm and the trim origin within it (top-left, in mm).
 */
export function computeMedia(
	doc: DocumentModel,
	marks: MarkSet,
	contentBounds?: Rect,
): { widthMm: number; heightMm: number; trimX: number; trimY: number } {
	const bleed = doc.bleed.enabled ? doc.bleed.amountMm : 0;
	const cb = contentBounds ?? { x: 0, y: 0, width: doc.page.width, height: doc.page.height };

	let left = -cb.x + bleed;
	let top = -cb.y + bleed;
	let right = cb.x + cb.width - doc.page.width + bleed;
	let bottom = cb.y + cb.height - doc.page.height + bleed;

	if (doc.registration.style !== 'none' && marks.primitives.length) {
		left = Math.max(left, -marks.bounds.x);
		top = Math.max(top, -marks.bounds.y);
		right = Math.max(right, marks.bounds.x + marks.bounds.width - doc.page.width);
		bottom = Math.max(bottom, marks.bounds.y + marks.bounds.height - doc.page.height);
	}

	return {
		widthMm: doc.page.width + left + right,
		heightMm: doc.page.height + top + bottom,
		trimX: left,
		trimY: top,
	};
}

const num = (value: number) => {
	const v = Number(value.toFixed(3));
	return Number.isInteger(v) ? String(v) : v.toString();
};

/**
 * Serialise a {@link MarkSet} to a single SVG path string in trim millimetres.
 * Used for both the live preview and any vector consumer.
 */
export function markSetToPath(marks: MarkSet): string {
	const parts: string[] = [];
	for (const p of marks.primitives) {
		if (p.type === 'line') {
			parts.push(`M ${num(p.x1)} ${num(p.y1)} L ${num(p.x2)} ${num(p.y2)}`);
		} else if (p.type === 'rect') {
			parts.push(
				`M ${num(p.x)} ${num(p.y)} H ${num(p.x + p.width)} V ${num(p.y + p.height)} H ${num(p.x)} Z`,
			);
		} else if (p.type === 'circle') {
			const d = 2 * p.r;
			parts.push(
				`M ${num(p.cx - p.r)} ${num(p.cy)} a ${num(p.r)} ${num(p.r)} 0 1 0 ${num(d)} 0 a ${num(p.r)} ${num(p.r)} 0 1 0 ${num(-d)} 0 Z`,
			);
		} else if (p.points.length > 1) {
			parts.push(
				`M ${num(p.points[0].x)} ${num(p.points[0].y)} ` +
					p.points
						.slice(1)
						.map((pt) => `L ${num(pt.x)} ${num(pt.y)}`)
						.join(' '),
			);
		}
	}
	return parts.join(' ');
}
