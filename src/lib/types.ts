/**
 * Core document model shared by the editor, the image pipeline and the
 * exporters. All geometric values are in millimetres unless the field name
 * says otherwise.
 */

export interface Size {
	width: number;
	height: number;
}

export interface Point {
	x: number;
	y: number;
}

/** Axis-aligned rectangle. */
export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** A decoded bitmap that layers can reference. */
export interface ImageSource {
	id: string;
	/** Object URL or data URL. */
	src: string;
	/** Native pixel dimensions. */
	width: number;
	height: number;
	/** Assumed source resolution, used when scaling to print DPI. */
	dpi: number;
}

export type LayerKind = 'image' | 'subject';

interface LayerBase {
	id: string;
	kind: LayerKind;
	name: string;
	visible: boolean;
	locked: boolean;
	/** 0..1 */
	opacity: number;
	/** Placement of the layer's top-left corner on the page, in mm. */
	x: number;
	y: number;
	/** Rendered size on the page, in mm. */
	width: number;
	height: number;
	/** Rotation around the layer centre, in degrees. */
	rotation: number;
}

export interface ImageLayer extends LayerBase {
	kind: 'image';
	sourceId: string;
}

export interface SubjectLayer extends LayerBase {
	kind: 'subject';
	sourceId: string;
	/**
	 * Alpha mask derived from background removal, as a data URL aligned to the
	 * source's pixel space. `null` until segmentation has run.
	 */
	maskDataUrl: string | null;
	/**
	 * Cut outline traced from the mask, in source pixel coordinates, as a list
	 * of closed polygons (first point repeated is not required).
	 */
	cutPolygons: Point[][];
	/** Grow the traced selection outwards by this many mm before the cut. */
	cutExpandMm: number;
	/** Corner smoothing of the cut outline, 0 (raw trace) to 1 (heavily rounded). */
	cutSmooth: number;
	/** Luminance threshold (0-255) used when tracing the mask. */
	traceThreshold: number;
	/** When true, pick the threshold automatically (Otsu's method). */
	traceAutoThreshold: boolean;
	/** Suppress traced specks smaller than this many source pixels. */
	traceDespeckle: number;
}

export type Layer = ImageLayer | SubjectLayer;

export interface BleedConfig {
	enabled: boolean;
	/** Bleed distance beyond the trim on each edge, in mm. */
	amountMm: number;
	/** How to fill the bleed area. */
	mode: 'mirror' | 'solid';
	solidColor: string;
}

export type MarkStyle = 'none' | 'silhouette' | 'cricut' | 'generic';

export interface RegistrationConfig {
	style: MarkStyle;
	/** Distance from the trim edge to the mark origin, in mm. */
	marginMm: number;
	/** Nominal mark size, in mm. */
	sizeMm: number;
	/** Stroke width of the marks, in mm. */
	lineWidthMm: number;
	/** Include a Data Matrix payload within the marks (Silhouette-style). */
	dataMatrix: boolean;
	/** Payload encoded in the Data Matrix. */
	dataMatrixValue: string;
}

export interface DocumentModel {
	name: string;
	/** Trim size, in mm. */
	page: Size;
	/** Target output resolution. */
	dpi: number;
	bleed: BleedConfig;
	registration: RegistrationConfig;
	layers: Layer[];
	/** Background fill drawn behind all layers, or '' for transparent. */
	background: string;
	/** Whether to draw the traced cut line on the print output. */
	showCutLine: boolean;
	/** Cut line colour (hex). */
	cutLineColor: string;
}
