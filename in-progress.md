# In progress

Working notes for the **bookmark head-overflow trim control** and the
document mask layer. Not user-facing docs.

## Goal

Two related changes to how the bookmark silhouette (`trimShape: 'bookmark'`)
is derived from the head subject layer.

### 1. Editable document mask layer (done)

The brush mask is no longer scoped to a single subject. There is now a
`MaskLayer` (layer kind `mask`) that **punches holes through every layer**, is
enable/disable-able with its layer eye, and has dedicated **Subtract** / **Add**
brushes. Editing a mask auto-re-traces subjects so the cut line follows the
holes.

- `types.ts` — `MaskLayer`, `LayerKind: 'mask'`, `MaskableLayer`.
- `state.svelte.ts` — rasterizes subtract/add strokes into a punch bitmap;
  reactive `maskRevision` so the preview updates on the first stroke.
- `geometry/transform.ts` — `drawInPixelSpace`/`mapPixelSpace` map a mask
  bitmap into another layer's pixel space.
- `image/ops.ts` — `renderTrim` punches mask layers out of the flatten.
- `components/MaskNode.svelte` — page-coloured punch overlay in the preview.

### 2. Head overflow control (in progress)

Problem: in bookmark mode the head band was clipped to the **page box**
(`x ∈ [0, w]`, `y ∈ [0, seamY]`), so a head that sits above / beside the page
got chopped flat. The plain base should keep cropping aggressively, but the
head should follow the subject outline.

Decision (user): add a **head overflow** control. The head band follows the
subject outline and may poke out beyond the page box by `headOverflowMm`
(top/left/right); the base still crops to the page. The media/output grows to
fit the overflowing head.

## Status

- [x] `BookmarkConfig.headOverflowMm` (default `0`, in `types.ts` /
      `defaultBookmark()`).
- [x] `buildTrimPolygons` extends the head band by the overflow instead of
      clipping to the page; `polygonsBounds` helper added.
- [x] `computeMedia(doc, marks, contentBounds?)` grows the media for a
      silhouette that overflows the page.
- [x] `renderTrim(..., region?)` renders an arbitrary page-mm region;
      `clipCanvasToPolygons(..., origin)` uses a region origin.
- [x] `artworkRect()` + `renderArtwork()` render and clip the region covering
      the overflowing head.
- [x] PDF exporter uses `contentBounds` + `artworkRect` for placement.
- [ ] SVG exporter: same `contentBounds` + `artworkRect` placement.
- [ ] Editor: pass `contentBounds` to `computeMedia`; make the
      `outsideMaskPath` outer rect cover the grown media.
- [ ] Inspector: `Head overflow (mm)` slider under Trim shape → bookmark.
- [ ] `pnpm check`, `pnpm test`, `pnpm build`.

## Notes

- `headOverflowMm = 0` reproduces the previous page-clipped behaviour, so it is
  backwards compatible.
- PDF `TrimBox` stays the rectangular page; the vector cut path (SVG is exact)
  is the authoritative silhouette.
- `artworkRect`/`computeMedia` both take the trim-outline bounds so the preview
  and the exporters agree.
