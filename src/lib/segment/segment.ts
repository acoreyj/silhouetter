import { blobToImage, buildAlphaMask } from '$lib/image/ops';

type ImglyModule = typeof import('@imgly/background-removal');

let modulePromise: Promise<ImglyModule> | null = null;

function loadModule(): Promise<ImglyModule> {
	modulePromise ??= import('@imgly/background-removal');
	return modulePromise;
}

export type SegmentProgress = (key: string, current: number, total: number) => void;

export interface SegmentResult {
	/** Cut-out foreground image with transparency. */
	foreground: HTMLImageElement;
	/** Binary alpha mask (black where subject) as a data URL. */
	maskDataUrl: string;
	/** Binary alpha mask as a canvas, ready for tracing. */
	maskCanvas: ReturnType<typeof buildAlphaMask>['canvas'];
	/** Natural pixel size of the result. */
	width: number;
	height: number;
}

/** Largest input we will feed to the model; larger inputs risk OOM on mobile. */
export const MAX_SEGMENT_PIXELS = 8192;

/**
 * Remove the background from an image entirely in the browser using the
 * IMG.LY ISNet model (ONNX Runtime Web / WebGPU). The alpha channel of the
 * returned foreground doubles as the subject mask.
 */
export async function segmentForeground(
	input: Blob | string,
	onProgress?: SegmentProgress,
): Promise<SegmentResult> {
	const { removeBackground } = await loadModule();

	const blob = await removeBackground(input, {
		device: 'gpu',
		model: 'isnet_fp16',
		output: { format: 'image/png' },
		progress: onProgress,
	});

	const foreground = await blobToImage(blob);
	if (
		foreground.naturalWidth > MAX_SEGMENT_PIXELS ||
		foreground.naturalHeight > MAX_SEGMENT_PIXELS
	) {
		throw new Error(
			`Image is too large (${foreground.naturalWidth}×${foreground.naturalHeight}). ` +
				`Maximum supported is ${MAX_SEGMENT_PIXELS}×${MAX_SEGMENT_PIXELS}.`,
		);
	}

	// Use the default cut-off + edge erosion so low-alpha fringes in tight gaps
	// do not survive as white halos. See `AlphaMaskOptions`.
	const { canvas, dataUrl } = buildAlphaMask(foreground);
	return {
		foreground,
		maskDataUrl: dataUrl,
		maskCanvas: canvas,
		width: foreground.naturalWidth,
		height: foreground.naturalHeight,
	};
}
