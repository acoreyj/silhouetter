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

export type LayerKind = 'image' | 'subject' | 'mask';

/** Overall trim outline of the finished item. */
export type TrimShapeKind = 'rect' | 'bookmark';

/**
 * A bookmark silhouette: a plain bookmark base for the bottom `baseFraction` of
 * the trim, topped by a subject layer's smoothed + expanded cut outline.
 */
export interface BookmarkConfig {
	/** Fraction of the trim height occupied by the plain base (bottom). 0..1. */
	baseFraction: number;
	/** Subject layer whose outline forms the top of the shape, if any. */
	subjectLayerId: string | null;
	/** Depth of the V-notch at the bottom centre, in mm (0 = no notch). */
	notchDepthMm: number;
	/** Radius of both bottom corners, in mm (0 = square). */
	cornerRadiusMm: number;
	/** Radius of the top-left corner of the plain base, in mm (0 = square). */
	cornerRadiusTopLeftMm: number;
	/** Radius of the top-right corner of the plain base, in mm (0 = square). */
	cornerRadiusTopRightMm: number;
	/**
	 * How far the head outline may extend beyond the page box (top/left/right),
	 * in mm. The head band follows the subject outline and is only clipped by
	 * this overflow; the plain base still crops to the page. 0 clips the head to
	 * the page box.
	 */
	headOverflowMm: number;
}

export type MaskStrokeMode = 'erase' | 'restore';

/** A brush stroke painted onto a subject layer's alpha mask. */
export interface MaskStroke {
	mode: MaskStrokeMode;
	/** Brush radius in source pixels. */
	radiusPx: number;
	/** Stroke centreline in source pixel space. */
	points: Point[];
	/**
	 * When present, the edit fills these closed polygons (source/mask pixel
	 * space) instead of stroking `points`. Used by the magic eraser, which
	 * flood-fills a similarly-coloured region and stores only its outline so the
	 * edit stays compact and undoable.
	 */
	fillPolygons?: Point[][];
}

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
	/**
	 * Brush strokes applied on top of the segmentation mask to locally erase or
	 * restore alpha, in source pixel space. Kept as strokes (rather than a
	 * second image) so undo snapshots stay small.
	 */
	maskStrokes: MaskStroke[];
}

/**
 * A document-level mask layer. Its opaque pixels are punched out of every other
 * layer (subtract) while hidden areas stay visible, so a single editable mask
 * can carve the whole composition and the cut outline.
 */
export interface MaskLayer extends LayerBase {
	kind: 'mask';
	/** Natural size of the mask bitmap, in pixels. */
	pixelWidth: number;
	pixelHeight: number;
	/**
	 * Base punched region as a data URL (opaque = hole), aligned to the mask
	 * layer's pixel space. `null` when the mask starts empty.
	 */
	maskDataUrl: string | null;
	/**
	 * Brush strokes that build the punched region. `erase` subtracts (adds a
	 * hole), `restore` adds (removes a hole), in mask pixel space.
	 */
	maskStrokes: MaskStroke[];
}

export type Layer = ImageLayer | SubjectLayer | MaskLayer;

/** Layers that own an editable mask (subject = keep mask, mask = hole mask). */
export type MaskableLayer = SubjectLayer | MaskLayer;

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
	/** Trim (bounding-box) size, in mm. */
	page: Size;
	/** Overall trim outline; 'rect' crops to the page box. */
	trimShape: TrimShapeKind;
	/** Bookmark silhouette parameters, used when `trimShape` is 'bookmark'. */
	bookmark: BookmarkConfig;
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
