import { describe, expect, it } from 'vitest';
import {
	PROJECT_FORMAT,
	PROJECT_VERSION,
	formatBytes,
	fromProjectFile,
	toProjectFile,
} from './project';
import { createDefaultDocument } from '$lib/doc.svelte';
import type { DocumentModel, ImageSource } from '$lib/types';

function fixture(): { doc: DocumentModel; sources: Record<string, ImageSource> } {
	const doc = createDefaultDocument();
	doc.layers.push({
		id: 'layer_1',
		kind: 'image',
		name: 'Background',
		visible: true,
		locked: false,
		opacity: 1,
		x: 0,
		y: 0,
		width: 50,
		height: 25,
		rotation: 0,
		sourceId: 'src_1',
	});
	return {
		doc,
		sources: {
			src_1: {
				id: 'src_1',
				src: 'data:image/png;base64,AAAA',
				width: 100,
				height: 50,
				dpi: 300,
			},
			src_2: {
				id: 'src_2',
				src: 'data:image/png;base64,BBBB',
				width: 10,
				height: 10,
				dpi: 300,
			},
		},
	};
}

describe('project serialisation', () => {
	it('stores referenced sources and drops unreferenced ones', async () => {
		const { doc, sources } = fixture();
		const file = await toProjectFile(doc, sources);
		expect(file.format).toBe(PROJECT_FORMAT);
		expect(file.version).toBe(PROJECT_VERSION);
		expect(file.sources).toHaveLength(1);
		expect(file.sources[0].dataUrl).toBe('data:image/png;base64,AAAA');
	});

	it('round-trips through JSON', async () => {
		const { doc, sources } = fixture();
		const file = await toProjectFile(doc, sources);
		const parsed = fromProjectFile(JSON.parse(JSON.stringify(file)));
		expect(parsed.doc.name).toBe(doc.name);
		expect(parsed.doc.layers).toHaveLength(1);
		expect(parsed.sources.src_1.src).toBe('data:image/png;base64,AAAA');
		expect(parsed.sources.src_1.width).toBe(100);
		expect(parsed.sources.src_1.dpi).toBe(300);
	});

	it('rejects foreign files', () => {
		expect(() => fromProjectFile({ hello: 'world' })).toThrow(/Silhouetter project/);
	});

	it('rejects files from a newer version', () => {
		const payload = {
			format: PROJECT_FORMAT,
			version: PROJECT_VERSION + 1,
			doc: createDefaultDocument(),
			sources: [],
		};
		expect(() => fromProjectFile(payload)).toThrow(/newer/);
	});

	it('formats byte sizes', () => {
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(2048)).toBe('2.0 KB');
		expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
	});
});
