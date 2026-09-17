import { DocumentStore } from './doc.svelte';
import type { ImageSource, Layer } from './types';
import { loadImageElement } from './image/ops';

export { DEFAULT_PAGE_SIZES, DPI_PRESETS, createDefaultDocument, newId } from './doc.svelte';

/** Single reactive document store for the whole editor. */
export const store = new DocumentStore();

const imageCache = new Map<string, HTMLImageElement>();
const maskCache = new Map<string, HTMLImageElement>();
const maskPromises = new Map<string, Promise<HTMLImageElement>>();

export function getSource(id: string): HTMLImageElement | undefined {
	return imageCache.get(id);
}

export async function loadSource(source: ImageSource): Promise<HTMLImageElement> {
	const cached = imageCache.get(source.id);
	if (cached) return cached;
	const el = await loadImageElement(source.src);
	imageCache.set(source.id, el);
	return el;
}

export function getMask(layerId: string): HTMLImageElement | undefined {
	return maskCache.get(layerId);
}

export async function loadMask(layerId: string, dataUrl: string): Promise<HTMLImageElement> {
	const cached = maskCache.get(layerId);
	if (cached) return cached;
	let promise = maskPromises.get(layerId);
	if (!promise) {
		promise = loadImageElement(dataUrl).then((el) => {
			maskCache.set(layerId, el);
			maskPromises.delete(layerId);
			return el;
		});
		maskPromises.set(layerId, promise);
	}
	return promise;
}

export function getMaskForLayer(layer: Layer): HTMLImageElement | undefined {
	return layer.kind === 'subject' ? maskCache.get(layer.id) : undefined;
}

export function releaseObjectUrls(): void {
	for (const source of Object.values(store.sources)) {
		if (source.src.startsWith('blob:')) URL.revokeObjectURL(source.src);
	}
}
