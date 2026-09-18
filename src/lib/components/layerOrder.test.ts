import { describe, expect, it } from 'vitest';
import { applyNodeOrder, type NodeList, type OrderedNode } from './layerOrder';

/** Minimal stand-in for a Konva container, keeping a real child order. */
class FakeContainer {
	children: FakeNode[] = [];

	getChildren(): FakeNode[] {
		return this.children;
	}

	add(...nodes: FakeNode[]): void {
		for (const node of nodes) {
			node.parent?.remove(node);
			node.parent = this;
			this.children.push(node);
		}
	}

	remove(node: FakeNode): void {
		const i = this.children.indexOf(node);
		if (i >= 0) this.children.splice(i, 1);
		node.parent = null;
	}

	moveToTop(node: FakeNode): void {
		const i = this.children.indexOf(node);
		if (i < 0) return;
		this.children.splice(i, 1);
		this.children.push(node);
	}

	names(): string[] {
		return this.children.map((n) => n.name);
	}
}

class FakeNode implements OrderedNode {
	parent: FakeContainer | null = null;
	constructor(readonly name: string) {}

	getParent(): unknown {
		return this.parent;
	}

	moveToTop(): void {
		this.parent?.moveToTop(this);
	}
}

function order(container: FakeContainer, ordered: FakeNode[], overlays: Set<FakeNode>) {
	applyNodeOrder(container as unknown as NodeList<FakeNode>, ordered, (n) => !overlays.has(n));
}

describe('applyNodeOrder', () => {
	it('keeps the Konva children in the given back-to-front order', () => {
		const stage = new FakeContainer();
		const tami = new FakeNode('tami');
		const bg = new FakeNode('bg');
		// Initially tami is below bg (tami imported first).
		stage.add(tami, bg);

		// The user brings tami forward: document order is now [bg, tami].
		order(stage, [bg, tami], new Set());

		expect(stage.names()).toEqual(['bg', 'tami']);
	});

	it('restores the document order after a send-backward', () => {
		const stage = new FakeContainer();
		const bg = new FakeNode('bg');
		const tami = new FakeNode('tami');
		stage.add(bg, tami);

		order(stage, [tami, bg], new Set());

		expect(stage.names()).toEqual(['tami', 'bg']);
	});

	it('keeps non-container overlays (mask punch) above the layers', () => {
		const stage = new FakeContainer();
		const tami = new FakeNode('tami');
		const bg = new FakeNode('bg');
		const punch = new FakeNode('punch');
		stage.add(tami, bg, punch);

		order(stage, [bg, tami], new Set([punch]));

		expect(stage.names()).toEqual(['bg', 'tami', 'punch']);
	});

	it('ignores nodes that are no longer attached', () => {
		const stage = new FakeContainer();
		const live = new FakeNode('live');
		const removed = new FakeNode('removed');
		stage.add(live);

		order(stage, [removed, live], new Set());

		expect(stage.names()).toEqual(['live']);
	});

	it('is idempotent', () => {
		const stage = new FakeContainer();
		const a = new FakeNode('a');
		const b = new FakeNode('b');
		const c = new FakeNode('c');
		stage.add(c, a, b);

		order(stage, [a, b, c], new Set());
		const once = stage.names();
		order(stage, [a, b, c], new Set());

		expect(stage.names()).toEqual(once);
		expect(once).toEqual(['a', 'b', 'c']);
	});
});
