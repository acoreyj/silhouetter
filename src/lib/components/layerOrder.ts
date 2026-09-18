/**
 * Z-order helpers for the Konva preview.
 *
 * `svelte-konva` appends each component's node to its parent once, at mount.
 * Reordering the `{#each}` (bring forward / send backward) moves the Svelte
 * components but does not touch Konva's child list, so the canvas would keep the
 * original stacking. {@link applyNodeOrder} re-applies a desired back-to-front
 * order to any object that exposes Konva's `getChildren` / `moveToTop` shape.
 */

/** The subset of `Konva.Node` that {@link applyNodeOrder} needs. */
export interface OrderedNode {
	getParent(): unknown;
	moveToTop(): void;
}

/** The subset of `Konva.Container` that {@link applyNodeOrder} needs. */
export interface NodeList<T extends OrderedNode> {
	getChildren(): T[];
}

/**
 * Reorder `container`'s children so the `ordered` nodes sit back-to-front in the
 * given order. Children that are not in `ordered` (per `isContainer`) are treated
 * as overlays and moved to the top, preserving the existing punch-overlay
 * behaviour in the editor.
 */
export function applyNodeOrder<T extends OrderedNode>(
	container: NodeList<T>,
	ordered: readonly T[],
	isContainer: (node: T) => boolean,
): void {
	for (const node of ordered) {
		if (node.getParent()) node.moveToTop();
	}
	for (const child of [...container.getChildren()]) {
		if (!isContainer(child)) child.moveToTop();
	}
}
