import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
	deleteProjectFromStorage,
	listSavedProjects,
	readProjectFromStorage,
	saveProjectToStorage,
} from './projectStorage.svelte';
import { PROJECT_FORMAT, PROJECT_VERSION, type ProjectFile } from './project';
import { createDefaultDocument } from '$lib/doc.svelte';

function project(name: string): ProjectFile {
	const doc = createDefaultDocument();
	doc.name = name;
	return {
		format: PROJECT_FORMAT,
		version: PROJECT_VERSION,
		name,
		savedAt: new Date().toISOString(),
		doc,
		sources: [
			{
				id: 'src_1',
				width: 10,
				height: 10,
				dpi: 300,
				dataUrl: 'data:image/png;base64,AAAA',
			},
		],
	};
}

const unique = () => `test-${Math.random().toString(36).slice(2, 10)}`;

describe('IndexedDB project storage', () => {
	it('saves, lists and reads a project', async () => {
		const name = unique();
		const meta = await saveProjectToStorage(name, project(name));
		expect(meta.name).toBe(name);
		expect(meta.bytes).toBeGreaterThan(0);

		const list = await listSavedProjects();
		expect(list.some((p) => p.name === name)).toBe(true);

		const loaded = (await readProjectFromStorage(name)) as ProjectFile;
		expect(loaded.format).toBe(PROJECT_FORMAT);
		expect(loaded.sources[0].dataUrl).toBe('data:image/png;base64,AAAA');

		await deleteProjectFromStorage(name);
		const after = await listSavedProjects();
		expect(after.some((p) => p.name === name)).toBe(false);
	});

	it('throws when reading a missing project', async () => {
		await expect(readProjectFromStorage(unique())).rejects.toThrow(/No saved project/);
	});

	it('overwrites an existing name', async () => {
		const name = unique();
		await saveProjectToStorage(name, project(name));
		await saveProjectToStorage(name, project(name));
		const list = await listSavedProjects();
		expect(list.filter((p) => p.name === name)).toHaveLength(1);
		await deleteProjectFromStorage(name);
	});
});
