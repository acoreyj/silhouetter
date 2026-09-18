# Architecture decisions

A running log of the significant choices behind Silhouetter and why they were made.
Format is a lightweight ADR: context → decision → consequences.

---

## 0001 — SvelteKit with the static adapter, running client-only

**Context.** The app manipulates images and generates PDFs. There is no requirement
for a database, auth, or server-side rendering, and keeping user images on-device is
a desirable property.

**Decision.** Use SvelteKit with `@sveltejs/adapter-static`, and disable SSR globally
via `export const ssr = false` in `src/routes/+layout.ts`. `prerender = true` emits a
SPA shell with an `index.html` fallback.

**Consequences.** Deployable to any static host. All heavy lifting must be possible
in a browser (it is). No server secrets or API routes. Anything requiring a trusted
server (e.g. commercial ML APIs) is off the table.

---

## 0002 — Konva (`svelte-konva`) for the editor

**Context.** Need a layers/groups scene graph with move/scale/rotate, masking,
compositing, and good Svelte 5 support.

**Decision.** `konva@10` + `svelte-konva@1`, which is runes-only and Svelte 5 native.
Layers are `Group`s positioned at their centre with children offset by `-w/2, -h/2`;
a `Transformer` handles interaction. Masks are composited into a single offscreen
canvas (`composeMasked`) rather than using `globalCompositeOperation` in the layer,
because `destination-in` on a shared canvas would clip sibling layers.

**Consequences.** Fast, declarative canvas editing. The transform round-trip
(Konva `scaleX/Y` → model `width/height`, scale reset to 1) is a small piece of
imperative glue in `LayerNode.svelte`.

---

## 0003 — All raster processing in Canvas 2D / OffscreenCanvas

**Context.** Bleed, crop, mask compositing, and flattening at a target DPI.

**Decision.** Implement raster ops directly with Canvas 2D (preferring
`OffscreenCanvas` where available) instead of adopting `sharp`. Flattening runs
synchronously at export DPI; `renderArtwork` is the single entry point.

**Consequences.** No native dependencies, works on static hosting. Large images are
bounded by a segmentation size guard (8192px) and object URLs are kept for the source
lifetime. If batch/server processing is ever needed, `sharp` is the natural addition.

---

## 0004 — `pdf-lib` for PDF export

**Context.** Need exact physical page sizes, bleed/trim boxes, embedded raster
artwork, and **vector** cut lines.

**Decision.** Use `pdf-lib`. Set `MediaBox`/`CropBox`/`BleedBox`/`TrimBox`, embed the
flattened PNG, draw registration marks as vectors, and draw cut contours with
`drawSvgPath`. `jsPDF` was rejected (weaker vector/box story, html2canvas rasterises);
PDFKit is server-oriented.

**Consequences.** Precise print geometry and small file sizes for vector marks. Text
would require embedding a TTF and `@pdf-lib/fontkit` (not currently needed). `pdf-lib`
is loaded lazily at export time.

---

## 0005 — `@imgly/background-removal` for segmentation (with an AGPL caveat)

**Context.** "Select outline" should be one-click, on-device, and private.

**Decision.** Use `@imgly/background-removal` on `onnxruntime-web` (WebGPU, ISNet
fp16). It runs locally and its foreground alpha doubles as the subject mask, so we
only run the model once.

**Consequences.**

- **License risk:** the package is **AGPL-3.0**. Acceptable for personal/local use;
  public hosting/distribution triggers copyleft obligations. The documented escape
  hatch is `@huggingface/transformers` + a permissive ONNX model.
- First run downloads ~40 MB of model data (cached). Threaded WASM benefits from
  COOP/COEP (see `static/_headers`); WebGPU does not need them.
- Segmentation and tracing are separate: re-tracing from the stored mask never
  re-runs the model (see 0008).

---

## 0006 — MIT tracer instead of the GPL `esm-potrace-wasm`

**Context.** Need bitmap→vector tracing for cut contours. The canonical browser
Potrace build, `esm-potrace-wasm`, is GPL-2.0. The Potrace name/algorithm also has
usage constraints.

**Decision.** Use `@cadit-app/potrace-ts` (MIT), a clean TypeScript implementation
that is worker-compatible and needs no DOM.

**Consequences.** Permissive licensing and easy bundling. We depend on its
`traceImageData(imageData, options, threshold)` API and `THRESHOLD_AUTO` (-1) for
Otsu. It ships extensionless ESM imports, so tests inline it via
`test.server.deps.inline`.

---

## 0007 — Clipper for offset, Chaikin for smoothing

**Context.** The raw trace has jagged, sharp corners, and cut lines need clearance
from the artwork.

**Decision.** `@doodle3d/clipper-js` performs polygon offsetting (round joins) and
merging; a small Chaikin corner-cutting routine (`vector/smooth.ts`) smooths
polygons. Clipper works in integers, so `offsetPolygons` scales up/down by 100 for
sub-unit precision and relies on Clipper's automatic orientation fixing.

**Consequences.** Resolution-independent, fast, and no second geometry dependency.
Smoothing slightly shrinks the shape, which is why it runs _before_ expansion and why
Expand should be set above the desired final clearance.

---

## 0008 — Cut outline pipeline: source px → mm → smooth → expand → page

**Context.** The cut path is derived from the segmentation mask, but must track the
layer's position, scale, and rotation.

**Decision.** Store the raw trace once (`layer.cutPolygons`, source-pixel space) and
build the final outline on demand in `export/cut.ts:buildCutPolygons`:
`polygonsToMm` → `smoothPolygons(cutSmooth)` → `offsetPolygons(cutExpandMm)` →
`transformPolygonsToPage`. Both the live preview (`LayerNode.svelte`) and both
exporters (`collectCutPolygons`) call this one function.

**Consequences.** The preview and the exported cut are always identical. Smoothing/
Expand are cheap to re-run live. Re-tracing (`retraceLayer`) is a separate, explicit
action that re-runs only the tracer against the stored mask, so threshold/despeckle
tweaks don't touch the expensive model.

---

## 0009 — Registration marks as shared vector primitives

**Context.** Different cutters want different fiducials; the same marks must appear
in both PDF and SVG.

**Decision.** `marks/index.ts` emits resolution-independent primitives (line, rect,
circle, polyline) in trim-relative millimetres, plus an optional Data Matrix payload.
`computeMedia` grows the media box to contain marks that sit outside the trim. A
`markSetToPath` helper feeds the Konva preview; the exporters consume the primitives.
Data Matrix is rendered lazily with `bwip-js`.

**Consequences.** One source of truth for marks across preview/PDF/SVG. Hardware
support is **not guaranteed**: Cricut and Silhouette both draw their own sensor marks
and warn against externally printed PDFs. The SVG export is the reliable path for
Design Space; marks must be validated on real hardware.

---

## 0010 — Millimetres are canonical; lazy-load the heavy dependencies

**Decision.** All page/layer geometry is millimetres; conversions to PDF points and
raster pixels are centralised in `units.ts`. `@imgly/background-removal`,
`onnxruntime-web`, `pdf-lib`, and `bwip-js` are imported dynamically so they stay out
of the initial bundle.

**Consequences.** Initial page chunk stays small; heavy code loads on first use.
Importers must be async, which the export and segmentation actions already are.

---

## 0011 — pnpm, with Node managed by vite-plus

**Context.** The environment provisions Node through vite-plus.

**Decision.** Use **pnpm** as the package manager (`packageManager: pnpm@12.4.2`) and
commit `pnpm-lock.yaml`. pnpm 12 reads non-auth settings from `pnpm-workspace.yaml`
(not `.npmrc` / the `package.json` `pnpm` field); `allowBuilds` approves the
`protobufjs` postinstall required by `onnxruntime-web`.

**Consequences.** Reproducible installs. Contributors need vite-plus for the Node
version and pnpm for dependencies. `npm`-authaled settings no longer apply.

---

## 0012 — Bookmark-shaped trim: a derived document outline

**Context.** A bookmark often needs a non-rectangular silhouette: a plain bookmark
base (notched bottom, rounded corners) topped by a character's cut outline so the
head pokes out above the page box. The document model only had a rectangular
`page`, and cut outlines were preview/export-only geometry that never clipped the
artwork.

**Decision.**

- Add `doc.trimShape: 'rect' | 'bookmark'` and `doc.bookmark` (base fraction,
  head layer, notch depth, corner radius). `'rect'` preserves the old behaviour.
- Derive a single trim outline in page millimetres (`geometry/shape.ts`,
  `buildTrimPolygons`): the bookmark base polygon unioned with the head layer's
  `buildSubjectOutline` clipped to the top band
  (`seamY = pageH · (1 − baseFraction)`). Because `buildSubjectOutline` already
  runs smooth → expand, the top of the shape reuses the exact Expand/Smoothing
  values that drive the cut line.
- Clip the flattened artwork to this outline (expanded by the bleed amount) at the
  end of `renderArtwork`, so the printed raster follows the silhouette.
- In bookmark mode a cutter follows the whole silhouette, so
  `collectCutPolygons` returns the document shape rather than per-subject loops.
- Keep geometry primitives in dependency-free leaf modules (`image/canvas.ts`,
  `geometry/transform.ts`) so the vector/geometry code does not import the raster
  pipeline that consumes it.

**Consequences.** The preview, PDF and SVG all derive from one outline. PDF's
`TrimBox` remains the rectangular bounding box (PDF cannot express the shape); the
vector cut path carries the true silhouette, and SVG is exact. Bleed is produced
by mirror-extruding the page canvas and clipping to the shape offset outwards, so
notch/corner bleed follows the outline rather than mirroring around curves.

---

## 0013 — Mask brush edits stored as strokes

**Context.** Background removal keeps the whole subject; a bookmark may need only
the head. The segmentation mask must be editable without re-running the model, and
undo snapshots must stay cheap.

**Decision.** Store brush edits on the subject layer as an ordered list of
`MaskStroke`s (`erase`/`restore`, radius and a polyline in source pixel space)
rather than a second mask image. `state.svelte.ts` derives the effective mask from
the cached raw segmentation mask plus the strokes, and caches the result keyed by a
revision counter; the preview and exporters read the derived mask through
`getMask`. Re-running background removal clears the strokes.

**Consequences.** Undo/redo carries only stroke metadata. Tracing still runs from
the mask on demand, so after painting the user must **Re-trace outline** to update
the cut and the bookmark shape — consistent with the existing trace/segment split
(0008).

---

## 0014 — Project persistence: named localStorage saves plus a downloadable file

**Context.** Work needs to survive a reload without re-importing images and
re-running segmentation. Browsers give us object URLs for imported files (not
persistable) and `localStorage` (persistable, small, string-only). There is no
server.

**Decision.** Define a versioned project format in `project.ts`
(`silhouetter-project` v1): the document (which already carries mask data URLs and
brush strokes) plus the referenced bitmaps, with object URLs converted to data URLs.
Unreferenced sources are dropped to save space. `projectStorage.svelte.ts` stores
named projects under `silhouetter.project.<name>` and exposes a reactive list.
`actions.ts` orchestrates save/load/download/open; a **Project** menu in the toolbar
(and `Ctrl`/`Cmd`+`S`) is the UI. Loading replaces the document through
`store.load` (undoable) and reloads sources and mask caches.

**Consequences.**
- Projects survive reloads and move between machines via `.silhouetter.json`.
- `localStorage` is per-browser with a ~5 MB quota; bitmaps are base64-inflated, so
  large projects can exceed it. `QuotaExceededError` is caught and surfaced as a
  clear "storage is full — delete a project or Download" message rather than a crash.
- Masks are stored as data URLs (already the case) and strokes as metadata (0013),
  so the format stays compact relative to a full raster snapshot.
- The format is versioned; loading a newer version fails with an explicit message.

---

## 0015 — Project storage moved from localStorage to IndexedDB

**Context.** ADR 0014 chose `localStorage` for named browser saves. In practice a
single imported bitmap (e.g. `bg.jpeg`, ~1 MB) is stored as a base64 data URL
(~1.4 M characters), and saving even one image could throw `QuotaExceededError`
against the ~5 MB browser quota — reported by users as "storage is full" despite an
empty store. Two images, or one image plus a segmentation mask, are guaranteed to
overflow.

**Decision.** Keep the named-project UX and file format, but back it with
**IndexedDB** (`projectStorage.svelte.ts`), using two object stores (`projects` for
the payload, `meta` for listing). IndexedDB structured-clones the data instead of
stringifying it and has a far larger quota, so bitmaps no longer need base64
inflation at rest. The `localStorage`-specific quota message is removed.

**Consequences.**
- Saving a normal project works, and image-heavy projects are limited by disk rather
  than a ~5 MB string quota.
- Storage functions are now async; `actions.ts` and `ProjectMenu.svelte` await them.
- Tests use `fake-indexeddb` to exercise save/list/read/delete without a browser.
- `localStorage` remains a poor fit for any future feature that stores image data;
  prefer IndexedDB or the Origin Private File System (OPFS).


