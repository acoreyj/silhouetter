import type { DocumentModel, Layer } from '$lib/types';
import { buildMarkSet, computeMedia, type MarkSet, type MarkPrimitive } from '$lib/marks';
import { renderArtwork, artworkRect, canvasToDataUrl } from '$lib/image/ops';
import { polygonsToSvgPath } from '$lib/vector/trace';
import { dataMatrixDataUrl } from '$lib/marks/datamatrix';
import { buildTrimPolygons, polygonsBounds } from '$lib/geometry/shape';
import { collectCutPolygons, shiftPolygons } from './cut';

export interface SvgExportOptions {
	doc: DocumentModel;
	getSource: (id: string) => HTMLImageElement | undefined;
	getMask: (layer: Layer) => HTMLImageElement | undefined;
	includeArtwork?: boolean;
	includeMarks?: boolean;
	includeCutLine?: boolean;
}

const EMPTY_MARKS: MarkSet = {
	primitives: [],
	dataMatrix: null,
	bounds: { x: 0, y: 0, width: 0, height: 0 },
};

const n = (value: number) => {
	const v = Number(value.toFixed(3));
	return Number.isInteger(v) ? String(v) : v.toString();
};

function escapeAttribute(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Export a cutter-friendly SVG. Coordinates are millimetres (viewBox units map
 * 1:1 to mm) so cutter software imports at physical size.
 */
export async function exportSvg(options: SvgExportOptions): Promise<string> {
	const { doc, getSource, getMask } = options;
	const includeArtwork = options.includeArtwork ?? true;
	const includeMarks = options.includeMarks ?? true;
	const includeCutLine = options.includeCutLine ?? doc.showCutLine;

	const marks = includeMarks ? buildMarkSet(doc) : EMPTY_MARKS;
	const contentBounds =
		doc.trimShape === 'rect'
			? undefined
			: (polygonsBounds(buildTrimPolygons(doc, getSource)) ?? undefined);
	const media = computeMedia(doc, marks, contentBounds);
	const tx = media.trimX;
	const ty = media.trimY;

	const parts: string[] = [];
	parts.push(`<title>${escapeAttribute(doc.name)}</title>`);

	// Artwork layer (raster at the export DPI). The canvas covers `artworkRect`
	// (trim outline + bleed) so an overflowing bookmark head is included.
	if (includeArtwork) {
		const art = renderArtwork(doc, getSource, getMask);
		const href = canvasToDataUrl(art);
		const rect = artworkRect(doc, getSource);
		const w = (art.width / doc.dpi) * 25.4;
		const h = (art.height / doc.dpi) * 25.4;
		parts.push(
			`<g id="artwork"><image x="${n(tx + rect.x)}" y="${n(ty + rect.y)}" ` +
				`width="${n(w)}" height="${n(h)}" preserveAspectRatio="none" href="${href}" /></g>`,
		);
	}

	// Registration marks.
	if (marks.primitives.length) {
		const markParts: string[] = [];
		const drawMark = (p: MarkPrimitive) => {
			const stroke = `fill="none" stroke="#000000" stroke-width="${n(p.type === 'line' || p.type === 'polyline' ? p.width : p.strokeWidth)}"`;
			if (p.type === 'line') {
				markParts.push(
					`<line x1="${n(tx + p.x1)}" y1="${n(ty + p.y1)}" x2="${n(tx + p.x2)}" y2="${n(ty + p.y2)}" ${stroke} stroke-linecap="round" />`,
				);
			} else if (p.type === 'rect') {
				markParts.push(
					`<rect x="${n(tx + p.x)}" y="${n(ty + p.y)}" width="${n(p.width)}" height="${n(p.height)}" ${stroke} />`,
				);
			} else if (p.type === 'circle') {
				markParts.push(
					`<circle cx="${n(tx + p.cx)}" cy="${n(ty + p.cy)}" r="${n(p.r)}" ${stroke} />`,
				);
			} else {
				const points = p.points.map((pt) => `${n(tx + pt.x)},${n(ty + pt.y)}`).join(' ');
				markParts.push(`<polyline points="${points}" ${stroke} />`);
			}
		};
		marks.primitives.forEach(drawMark);
		parts.push(`<g id="registration">${markParts.join('')}</g>`);
	}

	if (marks.dataMatrix) {
		const dm = marks.dataMatrix;
		const href = await dataMatrixDataUrl(dm.value);
		parts.push(
			`<image x="${n(tx + dm.x)}" y="${n(ty + dm.y)}" width="${n(dm.size)}" height="${n(dm.size)}" href="${href}" />`,
		);
	}

	// Vector cut line.
	if (includeCutLine) {
		const cut = collectCutPolygons(doc, getSource);
		if (cut.length) {
			const shifted = shiftPolygons(cut, tx, ty);
			const d = polygonsToSvgPath(shifted, 3);
			if (d) {
				parts.push(
					`<g id="cut"><path d="${d}" fill="none" stroke="${doc.cutLineColor || '#ff00aa'}" stroke-width="0.25" stroke-linejoin="round" /></g>`,
				);
			}
		}
	}

	return (
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
		`version="1.1" width="${n(media.widthMm)}mm" height="${n(media.heightMm)}mm" ` +
		`viewBox="0 0 ${n(media.widthMm)} ${n(media.heightMm)}" shape-rendering="geometricPrecision">` +
		parts.join('') +
		`</svg>`
	);
}
