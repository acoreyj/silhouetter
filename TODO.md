# TODO

Three follow-ups from the blueguy dragon bookmark session.

## 1. Default preset 66 × 166 mm

Make the out-of-the-box document a **66 mm wide, 166 mm tall** bookmark.

- [x] `src/lib/doc.svelte.ts:9` — add `{ label: 'Bookmark 66 × 166 mm', width: 66, height: 166 }`
      to `DEFAULT_PAGE_SIZES`.
- [x] `src/lib/doc.svelte.ts:44` — change `createDefaultDocument()` page to
      `{ width: 66, height: 166 }`.
- [x] Check other hard-coded `50 × 150` defaults (tests, project fixtures, README).
- [x] Default is the first preset in the dropdown, so it should also be the
      selected/first entry.

## 2. Move the selected layer after an auto-mask is added (+ auto-select toggle)

**Bug:** running _Remove background_ calls `ensureMaskLayer(subject)`
(`src/lib/actions.ts:133`), which adds a full-size mask layer on top of the
subject. Its transparent hit `Rect` (`src/lib/components/LayerNode.svelte:117-127`)
swallows pointer events, so the image underneath can no longer be clicked or
dragged.

**Desired behaviour:** dragging should move the **currently selected layer** by
default, regardless of what is under the cursor. Add an **Auto-select** toggle
so the old "click the topmost layer under the cursor" behaviour can be re-enabled.

- [x] Add an `autoSelect` flag to the editor/store (default `false`).
- [x] Stage `pointerdown` (`src/lib/components/Editor.svelte:100`):
      when auto-select is off, keep the current selection instead of clearing it;
      start dragging the selected layer.
- [x] `LayerNode.svelte:112` `onpointerdown` should only set the selection when
      auto-select is on; when off it should not steal the selection.
- [x] Make non-selected layers non-listening (or mask rect `listening={false}`)
      when auto-select is off, so they do not intercept the drag.
- [x] Add the **Auto-select** toggle to the toolbar/inspector and wire it through.
- [x] Verify: import → remove background → mask is auto-added → image can still
      be dragged immediately.

## 3. Background remover leaves white in tight spots

The ISNet mask keeps low-alpha fringes, so white/grey halos survive in narrow
gaps (visible along the dragon's neck/legs in the sample). `buildAlphaMask`
cuts at a fixed alpha threshold of `8` (`src/lib/image/ops.ts:31-53`), which
keeps a lot of near-transparent edge pixels.

- [x] Raise / make configurable the alpha cutoff used by `buildAlphaMask`
      (it is called with `8` from `src/lib/segment/segment.ts:58`).
- [x] Consider eroding the alpha edge by a pixel or two (feather + distance
      threshold) so thin white fringes in tight gaps are removed without
      eating the subject.
- [x] Ensure the traced cut outline and the composited preview use the same
      cleaned mask so the cut line matches.
- [x] Add a regression fixture / test for a tight-gap image if practical.
