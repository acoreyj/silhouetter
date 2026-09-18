import type { ProjectFile } from './project';

/**
 * Named projects are stored in IndexedDB rather than localStorage. A single
 * imported bitmap becomes a multi-megabyte base64 data URL, which overflows the
 * ~5 MB `localStorage` quota after one or two images; IndexedDB stores the data
 * natively (structured clone, no base64 inflation at rest) and has a far larger
 * quota. The UI is unchanged: projects are still "saved in this browser".
 */

export interface SavedProjectMeta {
	name: string;
	savedAt: string;
	bytes: number;
}

/** Reactive list of projects saved in the browser. */
export const savedProjectState = $state<{ projects: SavedProjectMeta[] }>({ projects: [] });

const DB_NAME = 'silhouetter';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const META = 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
		if (typeof indexedDB === 'undefined') {
			reject(new Error('This browser does not support saving projects locally.'));
			return;
		}
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(PROJECTS)) {
				db.createObjectStore(PROJECTS, { keyPath: 'name' });
			}
			if (!db.objectStoreNames.contains(META)) {
				db.createObjectStore(META, { keyPath: 'name' });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('Could not open project storage.'));
	});
	return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('Project storage request failed.'));
	});
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () =>
			reject(transaction.error ?? new Error('Project storage transaction failed.'));
		transaction.onabort = () =>
			reject(transaction.error ?? new Error('Project storage was aborted — the browser may be full.'));
	});
}

export async function listSavedProjects(): Promise<SavedProjectMeta[]> {
	const db = await openDb();
	const transaction = db.transaction(META, 'readonly');
	const metas = await requestToPromise<SavedProjectMeta[]>(transaction.objectStore(META).getAll());
	return metas.sort(
		(a, b) => (b.savedAt || '').localeCompare(a.savedAt || '') || a.name.localeCompare(b.name),
	);
}

export async function refreshSavedProjects(): Promise<void> {
	try {
		savedProjectState.projects = await listSavedProjects();
	} catch {
		savedProjectState.projects = [];
	}
}

export async function saveProjectToStorage(
	name: string,
	project: ProjectFile,
): Promise<SavedProjectMeta> {
	const db = await openDb();
	const meta: SavedProjectMeta = {
		name,
		savedAt: project.savedAt,
		bytes: JSON.stringify(project).length,
	};
	const transaction = db.transaction([PROJECTS, META], 'readwrite');
	transaction.objectStore(PROJECTS).put({ name, project });
	transaction.objectStore(META).put(meta);
	await transactionDone(transaction);
	await refreshSavedProjects();
	return meta;
}

export async function readProjectFromStorage(name: string): Promise<unknown> {
	const db = await openDb();
	const transaction = db.transaction(PROJECTS, 'readonly');
	const record = await requestToPromise<{ name: string; project: ProjectFile } | undefined>(
		transaction.objectStore(PROJECTS).get(name),
	);
	if (!record) throw new Error(`No saved project named "${name}".`);
	return record.project;
}

export async function deleteProjectFromStorage(name: string): Promise<void> {
	const db = await openDb();
	const transaction = db.transaction([PROJECTS, META], 'readwrite');
	transaction.objectStore(PROJECTS).delete(name);
	transaction.objectStore(META).delete(name);
	await transactionDone(transaction);
	await refreshSavedProjects();
}
