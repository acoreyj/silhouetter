import type bwipjsType from 'bwip-js/browser';

type BwipModule = { default: typeof bwipjsType };

let modulePromise: Promise<BwipModule> | null = null;

/** Lazily load the (large) barcode renderer only when Data Matrix is used. */
function loadBwip(): Promise<BwipModule> {
	modulePromise ??= import('bwip-js/browser') as Promise<BwipModule>;
	return modulePromise;
}

/** Render a Data Matrix barcode to a canvas at a high internal resolution. */
export async function renderDataMatrix(value: string, scale = 8): Promise<HTMLCanvasElement> {
	const { default: bwipjs } = await loadBwip();
	const canvas = document.createElement('canvas');
	bwipjs.toCanvas(canvas, {
		bcid: 'datamatrix',
		text: value || 'SILHOUETTER',
		scale,
		padding: 2,
		includetext: false
	});
	return canvas;
}

/** Render a Data Matrix barcode as a PNG data URL. */
export async function dataMatrixDataUrl(value: string, scale = 8): Promise<string> {
	return (await renderDataMatrix(value, scale)).toDataURL('image/png');
}
