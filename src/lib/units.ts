/**
 * Unit conversions for print work.
 *
 * Canonical internal unit for page geometry is the millimetre (mm).
 * PDF uses points (1pt = 1/72in). Raster work uses pixels at a target DPI.
 */

export const MM_PER_INCH = 25.4;
export const PT_PER_INCH = 72;
export const PT_PER_MM = PT_PER_INCH / MM_PER_INCH; // 2.834645669...

/** Millimetres → PDF points. */
export function mmToPt(mm: number): number {
	return mm * PT_PER_MM;
}

/** PDF points → millimetres. */
export function ptToMm(pt: number): number {
	return pt / PT_PER_MM;
}

/** Millimetres → pixels at the given DPI. */
export function mmToPx(mm: number, dpi: number): number {
	return (mm / MM_PER_INCH) * dpi;
}

/** Pixels at the given DPI → millimetres. */
export function pxToMm(px: number, dpi: number): number {
	return (px / dpi) * MM_PER_INCH;
}

/** Pixels at a source DPI → pixels at a target DPI. */
export function pxToPx(px: number, fromDpi: number, toDpi: number): number {
	return (px / fromDpi) * toDpi;
}

/** Round a number to a fixed number of decimals (default 0.01mm). */
export function round(value: number, decimals = 2): number {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
}

/** Clamp a value to the [min, max] range. */
export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
