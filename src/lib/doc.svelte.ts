import type {
	BookmarkConfig,
	DocumentModel,
	ImageSource,
	Layer,
	RegistrationConfig,
	SheetConfig,
} from '$lib/types';

export const DEFAULT_PAGE_SIZES: { label: string; width: number; height: number }[] = [
	{ label: 'Bookmark 66 × 166 mm', width: 66, height: 166 },
	{ label: 'Bookmark 50 × 150 mm', width: 50, height: 150 },
	{ label: 'Bookmark 40 × 120 mm', width: 40, height: 120 },
	{ label: 'A6 (105 × 148 mm)', width: 105, height: 148 },
	{ label: 'A5 (148 × 210 mm)', width: 148, height: 210 },
	{ label: 'A4 (210 × 297 mm)', width: 210, height: 297 },
	{ label: 'US Letter (216 × 279 mm)', width: 215.9, height: 279.4 },
];

export const DPI_PRESETS = [150, 300, 600];

export function defaultRegistration(): RegistrationConfig {
	return {
		style: 'generic',
		marginMm: 5,
		sizeMm: 5,
		lineWidthMm: 0.2,
		dataMatrix: false,
		dataMatrixValue: 'SILHOUETTER',
	};
}

export function defaultSheet(): SheetConfig {
	return { enabled: false, preset: 'a4-landscape', copies: 3, duplex: true };
}

export function defaultBookmark(): BookmarkConfig {
	return {
		baseFraction: 0.75,
		subjectLayerId: null,
		notchDepthMm: 6,
		cornerRadiusMm: 2,
		cornerRadiusTopLeftMm: 0,
		cornerRadiusTopRightMm: 0,
		headOverflowMm: 0,
	};
}

export function createDefaultDocument(): DocumentModel {
	return {
		name: 'Untitled bookmark',
		page: { width: 66, height: 166 },
		trimShape: 'rect',
		bookmark: defaultBookmark(),
		dpi: 300,
		bleed: { enabled: true, amountMm: 3, mode: 'mirror', solidColor: '#ffffff' },
		registration: defaultRegistration(),
		sheet: defaultSheet(),
		layers: [],
		background: '',
		showCutLine: true,
		cutLineColor: '#ff00aa',
	};
}

export function newId(prefix = 'id'): string {
	const uuid = globalThis.crypto?.randomUUID?.();
	return uuid ? `${prefix}_${uuid}` : `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Reactive document store with snapshot-based undo/redo.
 *
 * All mutations should go through {@link commit} so they become undoable.
 */
export class DocumentStore {
	doc = $state<DocumentModel>(createDefaultDocument());
	selectedId = $state<string | null>(null);
	/**
	 * When false (default), dragging always moves the currently selected layer,
	 * regardless of what is under the cursor. When true, clicking selects the
	 * topmost layer under the cursor (the classic direct-selection behaviour).
	 */
	autoSelect = $state(false);
	/** Metadata for every bitmap referenced by layers, keyed by source id. */
	sources = $state<Record<string, ImageSource>>({});

	#past: DocumentModel[] = [];
	#future: DocumentModel[] = [];
	#maxHistory = 100;

	get selected(): Layer | undefined {
		return this.doc.layers.find((l) => l.id === this.selectedId);
	}

	get canUndo(): boolean {
		return this.#past.length > 0;
	}

	get canRedo(): boolean {
		return this.#future.length > 0;
	}

	/** Deep, plain-object copy of the current document. */
	snapshot(): DocumentModel {
		return structuredClone($state.snapshot(this.doc)) as DocumentModel;
	}

	/** Apply a mutation to the document, recording it in the undo history. */
	commit(mutator: (doc: DocumentModel) => void): void {
		this.#past.push(this.snapshot());
		if (this.#past.length > this.#maxHistory) this.#past.shift();
		this.#future = [];
		mutator(this.doc);
	}

	/**
	 * Record the current state as an undo step without mutating. Use this before
	 * a live interaction (e.g. dragging a slider) whose intermediate values
	 * should not each become their own undo entry.
	 */
	begin(): void {
		this.#past.push(this.snapshot());
		if (this.#past.length > this.#maxHistory) this.#past.shift();
		this.#future = [];
	}

	/** Replace the whole document (e.g. load a project file). */
	load(doc: DocumentModel): void {
		this.#past.push(this.snapshot());
		this.#future = [];
		this.doc = structuredClone(doc);
		this.selectedId = null;
	}

	undo(): void {
		const prev = this.#past.pop();
		if (!prev) return;
		this.#future.push(this.snapshot());
		this.doc = prev;
		if (this.selectedId && !this.doc.layers.some((l) => l.id === this.selectedId)) {
			this.selectedId = null;
		}
	}

	redo(): void {
		const next = this.#future.pop();
		if (!next) return;
		this.#past.push(this.snapshot());
		this.doc = next;
	}

	addSource(source: ImageSource): void {
		this.sources = { ...this.sources, [source.id]: source };
	}

	addLayer(layer: Layer): void {
		this.commit((doc) => {
			doc.layers.push(layer);
		});
		this.selectedId = layer.id;
	}

	removeLayer(id: string): void {
		const index = this.doc.layers.findIndex((l) => l.id === id);
		if (index < 0) return;
		this.commit((doc) => {
			doc.layers.splice(index, 1);
		});
		if (this.selectedId === id) this.selectedId = null;
	}

	updateLayer(id: string, patch: Partial<Layer>): void {
		this.commit((doc) => {
			const layer = doc.layers.find((l) => l.id === id);
			if (layer) Object.assign(layer, patch);
		});
	}

	bringForward(id: string): void {
		this.commit((doc) => {
			const i = doc.layers.findIndex((l) => l.id === id);
			if (i >= 0 && i < doc.layers.length - 1) {
				[doc.layers[i], doc.layers[i + 1]] = [doc.layers[i + 1], doc.layers[i]];
			}
		});
	}

	sendBackward(id: string): void {
		this.commit((doc) => {
			const i = doc.layers.findIndex((l) => l.id === id);
			if (i > 0) {
				[doc.layers[i], doc.layers[i - 1]] = [doc.layers[i - 1], doc.layers[i]];
			}
		});
	}
}
