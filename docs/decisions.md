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
Smoothing slightly shrinks the shape, which is why it runs *before* expansion and why
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
