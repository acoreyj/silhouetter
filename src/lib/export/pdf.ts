import { PDFDocument, LineCapStyle, rgb } from 'pdf-lib';
import type { DocumentModel, Layer } from '$lib/types';
import { buildMarkSet, computeMedia, type MarkSet, type MarkPrimitive } from '$lib/marks';
import { mmToPt } from '$lib/units';
import { renderArtwork, artworkRect, canvasToPngBytes } from '$lib/image/ops';
import { polygonsToSvgPath } from '$lib/vector/trace';
import { renderDataMatrix } from '$lib/marks/datamatrix';
import { collectCutPolygons, shiftPolygons } from './cut';
import { hexToRgb } from './color';
import { buildTrimPolygons, polygonsBounds } from '$lib/geometry/shape';

export interface PdfExportOptions {
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

/** Export a print-ready PDF with bleed, crop boxes, registration marks and vector cut lines. */
export async function exportPdf(options: PdfExportOptions): Promise<Uint8Array> {
	const { doc, getSource, getMask } = options;
	const includeArtwork = options.includeArtwork ?? true;
	const includeMarks = options.includeMarks ?? true;
	const includeCutLine = options.includeCutLine ?? doc.showCutLine;

	const marks = includeMarks ? buildMarkSet(doc) : EMPTY_MARKS;
	const contentBounds =
		doc.trimShape === 'rect' ? undefined : (polygonsBounds(buildTrimPolygons(doc, getSource)) ?? undefined);
	const media = computeMedia(doc, marks, contentBounds);
	const mediaW = mmToPt(media.widthMm);
	const mediaH = mmToPt(media.heightMm);

	const pdf = await PDFDocument.create();
	pdf.setTitle(doc.name);
	pdf.setCreator('Silhouetter');
	pdf.setProducer('Silhouetter');

	const page = pdf.addPage([mediaW, mediaH]);

	// Page boxes: crop == media, trim is the bookmark, bleed surrounds the trim.
	const trimX = mmToPt(media.trimX);
	const trimBottom = mmToPt(media.heightMm - media.trimY - doc.page.height);
	const trimW = mmToPt(doc.page.width);
	const trimH = mmToPt(doc.page.height);
	page.setMediaBox(0, 0, mediaW, mediaH);
	page.setCropBox(0, 0, mediaW, mediaH);
	page.setTrimBox(trimX, trimBottom, trimW, trimH);
	const bleed = doc.bleed.enabled ? doc.bleed.amountMm : 0;
	page.setBleedBox(
		trimX - mmToPt(bleed),
		trimBottom - mmToPt(bleed),
		trimW + mmToPt(bleed * 2),
		trimH + mmToPt(bleed * 2),
	);

	// Flattened artwork (trim + bleed), positioned by its top-left corner.
	if (includeArtwork) {
		const artwork = renderArtwork(doc, getSource, getMask);
		const image = await pdf.embedPng(await canvasToPngBytes(artwork));
		const rect = artworkRect(doc, getSource);
		const artW = mmToPt(rect.width);
		const artH = mmToPt(rect.height);
		const artX = mmToPt(media.trimX + rect.x);
		const artTop = media.trimY + rect.y;
		const artY = mmToPt(media.heightMm - artTop) - artH;
		page.drawImage(image, { x: artX, y: artY, width: artW, height: artH });
	}

	// Registration marks (vector).
	const X = (x: number) => mmToPt(media.trimX + x);
	const Y = (y: number) => mmToPt(media.heightMm - (media.trimY + y));
	const black = rgb(0, 0, 0);

	const drawMark = (p: MarkPrimitive) => {
		if (p.type === 'line') {
			page.drawLine({
				start: { x: X(p.x1), y: Y(p.y1) },
				end: { x: X(p.x2), y: Y(p.y2) },
				thickness: mmToPt(p.width),
				color: black,
			});
		} else if (p.type === 'rect') {
			page.drawRectangle({
				x: X(p.x),
				y: Y(p.y + p.height),
				width: mmToPt(p.width),
				height: mmToPt(p.height),
				borderWidth: mmToPt(p.strokeWidth),
				borderColor: black,
			});
		} else if (p.type === 'circle') {
			page.drawCircle({
				x: X(p.cx),
				y: Y(p.cy),
				size: mmToPt(p.r),
				borderWidth: mmToPt(p.strokeWidth),
				borderColor: black,
			});
		} else {
			for (let i = 1; i < p.points.length; i++) {
				page.drawLine({
					start: { x: X(p.points[i - 1].x), y: Y(p.points[i - 1].y) },
					end: { x: X(p.points[i].x), y: Y(p.points[i].y) },
					thickness: mmToPt(p.width),
					color: black,
				});
			}
		}
	};
	marks.primitives.forEach(drawMark);

	// Data Matrix payload (rendered as a small raster).
	if (marks.dataMatrix) {
		const dm = marks.dataMatrix;
		const bytes = await canvasToPngBytes(await renderDataMatrix(dm.value));
		const image = await pdf.embedPng(bytes);
		const size = mmToPt(dm.size);
		page.drawImage(image, { x: X(dm.x), y: Y(dm.y + dm.size), width: size, height: size });
	}

	// Vector cut contours, drawn at 0.25mm.
	if (includeCutLine) {
		const cut = collectCutPolygons(doc, getSource);
		if (cut.length) {
			const shifted = shiftPolygons(cut, media.trimX, media.trimY);
			const path = polygonsToSvgPath(shifted, 3, (p) => ({
				x: mmToPt(p.x),
				y: mmToPt(p.y),
			}));
			if (path) {
				const c = hexToRgb(doc.cutLineColor, { r: 1, g: 0, b: 0.67 });
				page.drawSvgPath(path, {
					x: 0,
					y: mediaH,
					borderColor: rgb(c.r, c.g, c.b),
					borderWidth: mmToPt(0.25),
					borderLineCap: LineCapStyle.Round,
				});
			}
		}
	}

	return pdf.save();
}
