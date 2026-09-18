import type { Rect, SheetPreset } from '$lib/types';

/**
 * Multi-up imposition maths. Copies of one item's footprint (trim + bleed + any
 * overflow) are laid out in a single row across a landscape sheet, centred and
 * separated by a small gutter, leaving `marginMm` free on every edge for the
 * registration marks.
 *
 * Pure millimetre geometry with no canvas/PDF dependency so it can be unit
 * tested in isolation.
 */

export interface SheetSize {
	widthMm: number;
	heightMm: number;
}

export interface Placement {
	/** Top-left corner of the copy's footprint, in sheet millimetres. */
	x: number;
	y: number;
}

export interface ImpositionInput {
	sheet: SheetSize;
	/** Footprint of a single copy, including bleed and head overflow, in mm. */
	item: SheetSize;
	copies: number;
	/** Space reserved on every edge for the registration marks, in mm. */
	marginMm: number;
	/** Preferred gap between adjacent copies, in mm. */
	gutterMm?: number;
}

export interface Imposition {
	placements: Placement[];
	/** Bounding box of the whole imposed group (copies + gutters), in mm. */
	group: Rect;
	/** Total height of the group (equal to the item height). */
	heightMm: number;
	/** False when the group plus its mark margin overflows the sheet. */
	fits: boolean;
}

export const DEFAULT_GUTTER_MM = 4;

export const SHEET_PRESETS: {
	value: SheetPreset;
	label: string;
	width: number;
	height: number;
}[] = [
	{ value: 'a4-landscape', label: 'A4 landscape (297 × 210 mm)', width: 297, height: 210 },
	{
		value: 'letter-landscape',
		label: 'US Letter landscape (279.4 × 215.9 mm)',
		width: 279.4,
		height: 215.9,
	},
];

export function sheetSizeFor(preset: SheetPreset): SheetSize {
	const found = SHEET_PRESETS.find((p) => p.value === preset) ?? SHEET_PRESETS[0];
	return { widthMm: found.width, heightMm: found.height };
}

export function imposeSheet(input: ImpositionInput): Imposition {
	const { sheet, item, marginMm } = input;
	const copies = Math.max(1, Math.round(input.copies));
	const preferredGutter = Math.max(0, input.gutterMm ?? DEFAULT_GUTTER_MM);
	const usableW = sheet.widthMm - marginMm * 2;
	const usableH = sheet.heightMm - marginMm * 2;

	// Shrink the gutter if the row would otherwise overflow the usable width.
	let gutter = preferredGutter;
	const withGutter = (g: number) => copies * item.widthMm + (copies - 1) * g;
	if (copies > 1 && withGutter(gutter) > usableW) {
		const available = usableW - copies * item.widthMm;
		gutter = available > 0 ? available / (copies - 1) : 0;
	}

	const groupW = withGutter(gutter);
	const groupH = item.heightMm;
	const groupX = (sheet.widthMm - groupW) / 2;
	const groupY = (sheet.heightMm - groupH) / 2;

	const placements: Placement[] = [];
	for (let i = 0; i < copies; i++) {
		placements.push({ x: groupX + i * (item.widthMm + gutter), y: groupY });
	}

	const epsilon = 1e-6;
	const fits = groupW <= usableW + epsilon && groupH <= usableH + epsilon;
	return {
		placements,
		group: { x: groupX, y: groupY, width: groupW, height: groupH },
		heightMm: groupH,
		fits,
	};
}
