import { PDFDocument, LineCapStyle, rgb, type PDFImage, type PDFPage } from 'pdf-lib';
import type { DocumentModel, Layer, Point, Rect } from '$lib/types';
import { buildMarkSet, computeMedia, type MarkSet, type MarkPrimitive } from '$lib/marks';
import { mmToPt } from '$lib/units';
import { renderArtwork, artworkRect, canvasToPngBytes } from '$lib/image/ops';
import { polygonsToSvgPath } from '$lib/vector/trace';
import { renderDataMatrix } from '$lib/marks/datamatrix';
import { collectCutPolygons, shiftPolygons } from './cut';
import { hexToRgb } from './color';
import { buildTrimPolygons, polygonsBounds } from '$lib/geometry/shape';
import { DEFAULT_GUTTER_MM, imposeSheet, sheetSizeFor } from './impose';

export interface PdfExportOptions {
	doc: DocumentModel;
	getSource: (id: string) => HTMLImageElement | undefined;
	getMask: (layer: Layer) => HTMLImageElement | undefined;
	includeArtwork?: boolean;
	includeMarks?: boolean;
	includeCutLine?: boolean;
}

interface Media {
	widthMm: number;
	heightMm: number;
	trimX: number;
	trimY: number;
}

interface Frame {
	/** Page-mm x of the frame's left edge. */
	x: number;
	/** Page-mm y (downwards) of the frame's top edge. */
	y: number;
	/** Full height of the frame, used for the PDF y-axis flip. */
	heightMm: number;
}

const EMPTY_MARKS: MarkSet = {
	primitives: [],
	dataMatrix: null,
	bounds: { x: 0, y: 0, width: 0, height: 0 },
};

const BLACK = rgb(0, 0, 0);
const CUT_WIDTH_MM = 0.25;
const CUT_SVG_PRECISION = 3;

function contentBoundsFor(
	doc: DocumentModel,
	getSource: (id: string) => HTMLImageElement | undefined,
): Rect | undefined {
	return doc.trimShape === 'rect'
		? undefined
		: (polygonsBounds(buildTrimPolygons(doc, getSource)) ?? undefined);
}

/** Convert frame-local millimetres to PDF points (y flipped, origin bottom-left). */
function mapper(frame: Frame) {
	return {
		X: (x: number) => mmToPt(frame.x + x),
		Y: (y: number) => mmToPt(frame.heightMm - (frame.y + y)),
	};
}

/** Mirror a mark set horizontally within a frame `width` mm wide. */
function mirrorMarkSetX(marks: MarkSet, width: number): MarkSet {
	const mx = (x: number) => width - x;
	const primitives = marks.primitives.map((p): MarkPrimitive => {
		if (p.type === 'line') return { ...p, x1: mx(p.x1), x2: mx(p.x2) };
		if (p.type === 'rect') return { ...p, x: mx(p.x + p.width) };
		if (p.type === 'circle') return { ...p, cx: mx(p.cx) };
		return { ...p, points: p.points.map((pt) => ({ x: mx(pt.x), y: pt.y })) };
	});
	const dataMatrix = marks.dataMatrix
		? { ...marks.dataMatrix, x: mx(marks.dataMatrix.x + marks.dataMatrix.size) }
		: null;
	return {
		primitives,
		dataMatrix,
		bounds: {
			x: mx(marks.bounds.x + marks.bounds.width),
			y: marks.bounds.y,
			width: marks.bounds.width,
			height: marks.bounds.height,
		},
	};
}

/** Mirror page-mm cut polygons horizontally about `axisX`. */
function mirrorPolygonsX(polygons: Point[][], axisX: number): Point[][] {
	return polygons.map((poly) => poly.map((p) => ({ x: 2 * axisX - p.x, y: p.y })));
}

/** Draw a mark set (and its Data Matrix) into a PDF page frame. */
function drawMarkSet(page: PDFPage, marks: MarkSet, frame: Frame, dm: PDFImage | null): void {
	const { X, Y } = mapper(frame);

	for (const p of marks.primitives) {
		if (p.type === 'line') {
			page.drawLine({
				start: { x: X(p.x1), y: Y(p.y1) },
				end: { x: X(p.x2), y: Y(p.y2) },
				thickness: mmToPt(p.width),
				color: BLACK,
			});
		} else if (p.type === 'rect') {
			page.drawRectangle({
				x: X(p.x),
				y: Y(p.y + p.height),
				width: mmToPt(p.width),
				height: mmToPt(p.height),
				borderWidth: mmToPt(p.strokeWidth),
				borderColor: BLACK,
			});
		} else if (p.type === 'circle') {
			page.drawCircle({
				x: X(p.cx),
				y: Y(p.cy),
				size: mmToPt(p.r),
				borderWidth: mmToPt(p.strokeWidth),
				borderColor: BLACK,
			});
		} else {
			for (let i = 1; i < p.points.length; i++) {
				page.drawLine({
					start: { x: X(p.points[i - 1].x), y: Y(p.points[i - 1].y) },
					end: { x: X(p.points[i].x), y: Y(p.points[i].y) },
					thickness: mmToPt(p.width),
					color: BLACK,
				});
			}
		}
	}

	if (marks.dataMatrix && dm) {
		const d = marks.dataMatrix;
		const size = mmToPt(d.size);
		page.drawImage(dm, { x: X(d.x), y: Y(d.y + d.size), width: size, height: size });
	}
}

/** Draw one bookmark's artwork and cut line at the frame origin. */
function drawBookmark(
	page: PDFPage,
	ox: number,
	oy: number,
	media: Media,
	art: PDFImage | null,
	artRect: Rect,
	cutPolygons: Point[][],
	cutColor: { r: number; g: number; b: number },
	includeCutLine: boolean,
): void {
	if (art) {
		const artW = mmToPt(artRect.width);
		const artH = mmToPt(artRect.height);
		const artX = mmToPt(ox + media.trimX + artRect.x);
		const artY = mmToPt(oy + media.heightMm - (media.trimY + artRect.y)) - artH;
		page.drawImage(art, { x: artX, y: artY, width: artW, height: artH });
	}

	if (includeCutLine && cutPolygons.length) {
		const shifted = shiftPolygons(cutPolygons, media.trimX, media.trimY);
		const path = polygonsToSvgPath(shifted, CUT_SVG_PRECISION, (p) => ({
			x: mmToPt(p.x),
			y: mmToPt(p.y),
		}));
		if (path) {
			page.drawSvgPath(path, {
				x: mmToPt(ox),
				y: mmToPt(oy + media.heightMm),
				borderColor: rgb(cutColor.r, cutColor.g, cutColor.b),
				borderWidth: mmToPt(CUT_WIDTH_MM),
				borderLineCap: LineCapStyle.Round,
			});
		}
	}
}

async function embedArtwork(
	pdf: PDFDocument,
	doc: DocumentModel,
	getSource: (id: string) => HTMLImageElement | undefined,
	getMask: (layer: Layer) => HTMLImageElement | undefined,
	side: 'front' | 'back',
): Promise<PDFImage> {
	const artwork = renderArtwork(doc, getSource, getMask, { side });
	return await pdf.embedPng(await canvasToPngBytes(artwork));
}

async function embedDataMatrix(pdf: PDFDocument, value: string): Promise<PDFImage> {
	return await pdf.embedPng(await canvasToPngBytes(await renderDataMatrix(value)));
}

/** One page per bookmark: media sized to the trim, bleed and marks. */
async function renderSingle(
	pdf: PDFDocument,
	doc: DocumentModel,
	getSource: (id: string) => HTMLImageElement | undefined,
	getMask: (layer: Layer) => HTMLImageElement | undefined,
	options: Required<Pick<PdfExportOptions, 'includeArtwork' | 'includeMarks' | 'includeCutLine'>>,
): Promise<void> {
	const marks = options.includeMarks ? buildMarkSet(doc) : EMPTY_MARKS;
	const media = computeMedia(doc, marks, contentBoundsFor(doc, getSource));
	const mediaW = mmToPt(media.widthMm);
	const mediaH = mmToPt(media.heightMm);

	const page = pdf.addPage([mediaW, mediaH]);

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

	const art = options.includeArtwork ? await embedArtwork(pdf, doc, getSource, getMask, 'front') : null;
	const artRect = artworkRect(doc, getSource);
	const cut = options.includeCutLine ? collectCutPolygons(doc, getSource) : [];
	const cutColor = hexToRgb(doc.cutLineColor, { r: 1, g: 0, b: 0.67 });

	drawBookmark(page, 0, 0, media, art, artRect, cut, cutColor, options.includeCutLine);

	const dm = marks.dataMatrix ? await embedDataMatrix(pdf, marks.dataMatrix.value) : null;
	drawMarkSet(page, marks, { x: 0, y: 0, heightMm: media.heightMm }, dm);
}

/** Impose several copies on landscape sheets, optionally with a mirrored back. */
async function renderSheet(
	pdf: PDFDocument,
	doc: DocumentModel,
	getSource: (id: string) => HTMLImageElement | undefined,
	getMask: (layer: Layer) => HTMLImageElement | undefined,
	options: Required<Pick<PdfExportOptions, 'includeArtwork' | 'includeMarks' | 'includeCutLine'>>,
): Promise<void> {
	// Each copy's media covers its trim outline + bleed; marks wrap the group.
	const media = computeMedia(doc, EMPTY_MARKS, contentBoundsFor(doc, getSource));
	const sheet = sheetSizeFor(doc.sheet.preset);
	const marginMm =
		options.includeMarks && doc.registration.style !== 'none' ? doc.registration.marginMm : 0;
	const imposition = imposeSheet({
		sheet,
		item: { widthMm: media.widthMm, heightMm: media.heightMm },
		copies: doc.sheet.copies,
		marginMm,
		gutterMm: DEFAULT_GUTTER_MM,
	});
	const group = imposition.group;

	const marks = options.includeMarks
		? buildMarkSet(doc, { width: group.width, height: group.height })
		: EMPTY_MARKS;
	const dm = marks.dataMatrix ? await embedDataMatrix(pdf, marks.dataMatrix.value) : null;

	const artRect = artworkRect(doc, getSource);
	const cut = options.includeCutLine ? collectCutPolygons(doc, getSource) : [];
	const cutColor = hexToRgb(doc.cutLineColor, { r: 1, g: 0, b: 0.67 });
	const sheetW = mmToPt(sheet.widthMm);
	const sheetH = mmToPt(sheet.heightMm);

	const frontArt = options.includeArtwork
		? await embedArtwork(pdf, doc, getSource, getMask, 'front')
		: null;
	const front = pdf.addPage([sheetW, sheetH]);
	setSheetBoxes(front, doc, sheet.widthMm, sheet.heightMm, group);
	for (const p of imposition.placements) {
		drawBookmark(front, p.x, p.y, media, frontArt, artRect, cut, cutColor, options.includeCutLine);
	}
	drawMarkSet(front, marks, { x: group.x, y: group.y, heightMm: sheet.heightMm }, dm);

	if (!doc.sheet.duplex) return;

	const backArt = options.includeArtwork
		? await embedArtwork(pdf, doc, getSource, getMask, 'back')
		: null;
	const back = pdf.addPage([sheetW, sheetH]);
	setSheetBoxes(back, doc, sheet.widthMm, sheet.heightMm, group);

	// Mirror each copy about the sheet centreline; the cut follows the geometry
	// while the (already baked) back artwork is placed un-mirrored.
	const axisPageX = media.widthMm / 2 - media.trimX;
	const backCut = mirrorPolygonsX(cut, axisPageX);
	for (const p of imposition.placements) {
		const px = sheet.widthMm - p.x - media.widthMm;
		drawBookmark(back, px, p.y, media, backArt, artRect, backCut, cutColor, options.includeCutLine);
	}
	const groupX = sheet.widthMm - group.x - group.width;
	drawMarkSet(
		back,
		mirrorMarkSetX(marks, group.width),
		{ x: groupX, y: group.y, heightMm: sheet.heightMm },
		dm,
	);
}

function setSheetBoxes(
	page: PDFPage,
	doc: DocumentModel,
	widthMm: number,
	heightMm: number,
	group: Rect,
): void {
	const w = mmToPt(widthMm);
	const h = mmToPt(heightMm);
	const bleed = doc.bleed.enabled ? doc.bleed.amountMm : 0;
	page.setMediaBox(0, 0, w, h);
	page.setCropBox(0, 0, w, h);
	const trimY = mmToPt(heightMm - (group.y + group.height));
	page.setTrimBox(mmToPt(group.x), trimY, mmToPt(group.width), mmToPt(group.height));
	page.setBleedBox(
		mmToPt(group.x - bleed),
		trimY - mmToPt(bleed),
		mmToPt(group.width + bleed * 2),
		mmToPt(group.height + bleed * 2),
	);
}

/** Export a print-ready PDF with bleed, crop boxes, registration marks and vector cut lines. */
export async function exportPdf(options: PdfExportOptions): Promise<Uint8Array> {
	const { doc, getSource, getMask } = options;
	const flags = {
		includeArtwork: options.includeArtwork ?? true,
		includeMarks: options.includeMarks ?? true,
		includeCutLine: options.includeCutLine ?? doc.showCutLine,
	};

	const pdf = await PDFDocument.create();
	pdf.setTitle(doc.name);
	pdf.setCreator('Silhouetter');
	pdf.setProducer('Silhouetter');

	if (doc.sheet?.enabled) {
		await renderSheet(pdf, doc, getSource, getMask, flags);
	} else {
		await renderSingle(pdf, doc, getSource, getMask, flags);
	}

	return pdf.save();
}
