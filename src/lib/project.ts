import type { DocumentModel, ImageSource } from './types';

/**
 * Project file format. A project bundles the document (which already contains
 * mask data URLs and brush strokes) with a copy of every bitmap the layers
 * reference. Object URLs are converted to data URLs so a project survives a
 * page reload and can be written to disk.
 */

export const PROJECT_FORMAT = 'silhouetter-project';
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = 'silhouetter.json';

export interface StoredSource {
	id: string;
	width: number;
	height: number;
	dpi: number;
	dataUrl: string;
}

export interface ProjectFile {
	format: typeof PROJECT_FORMAT;
	version: number;
	name: string;
	savedAt: string;
	doc: DocumentModel;
	sources: StoredSource[];
}

/** Read a Blob URL into a data URL. */
async function blobUrlToDataUrl(url: string): Promise<string> {
	const blob = await fetch(url).then((response) => {
		if (!response.ok) throw new Error(`Could not read image source (${response.status})`);
		return response.blob();
	});
	return await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error ?? new Error('Failed to read image data'));
		reader.readAsDataURL(blob);
	});
}

/** Convert an object URL to a data URL; data URLs pass through untouched. */
export function sourceToDataUrl(src: string): Promise<string> {
	return src.startsWith('data:') ? Promise.resolve(src) : blobUrlToDataUrl(src);
}

/** Source ids that are still referenced by a layer. */
function referencedSourceIds(doc: DocumentModel): Set<string> {
	const ids = new Set<string>();
	for (const layer of doc.layers) {
		if (layer.kind !== 'mask') ids.add(layer.sourceId);
	}
	return ids;
}

/** Build a serialisable project from a plain document and its source registry. */
export async function toProjectFile(
	doc: DocumentModel,
	sources: Record<string, ImageSource>,
): Promise<ProjectFile> {
	const referenced = referencedSourceIds(doc);
	const stored: StoredSource[] = [];
	for (const source of Object.values(sources)) {
		if (!referenced.has(source.id)) continue;
		stored.push({
			id: source.id,
			width: source.width,
			height: source.height,
			dpi: source.dpi,
			dataUrl: await sourceToDataUrl(source.src),
		});
	}
	return {
		format: PROJECT_FORMAT,
		version: PROJECT_VERSION,
		name: doc.name,
		savedAt: new Date().toISOString(),
		doc,
		sources: stored,
	};
}

/** Parse and validate an untrusted project object. */
export function fromProjectFile(input: unknown): {
	doc: DocumentModel;
	sources: Record<string, ImageSource>;
} {
	const data = input as Partial<ProjectFile> | null;
	if (!data || typeof data !== 'object') {
		throw new Error('That file is not a Silhouetter project.');
	}
	if (data.format !== PROJECT_FORMAT) {
		throw new Error('That file is not a Silhouetter project.');
	}
	if (typeof data.version !== 'number' || data.version > PROJECT_VERSION) {
		throw new Error(`Project version ${String(data.version)} is newer than this app supports.`);
	}
	if (!data.doc || !Array.isArray(data.sources)) {
		throw new Error('The project file is missing data.');
	}

	const sources: Record<string, ImageSource> = {};
	for (const source of data.sources) {
		if (!source || typeof source.id !== 'string' || typeof source.dataUrl !== 'string') continue;
		sources[source.id] = {
			id: source.id,
			src: source.dataUrl,
			width: source.width,
			height: source.height,
			dpi: source.dpi,
		};
	}

	return { doc: data.doc as DocumentModel, sources };
}

/** Human-readable byte size for the saved-project list. */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
