# Silhouetter

A client-side editor for making print-and-cut bookmarks and similar items. Combine
backgrounds and character cut-outs, trace a cut outline around the subject, add
bleed and registration marks, then export a print-ready **PDF** or a cutter-friendly
**SVG**.

Everything runs in the browser — images never leave the device and there is no
server component.

## Stack

| Concern            | Choice                                                              |
| ------------------ | ------------------------------------------------------------------- |
| App shell          | SvelteKit + `@sveltejs/adapter-static`, client-only (`ssr = false`) |
| Editor / layers    | `konva` + `svelte-konva` (Svelte 5 runes)                           |
| Raster ops         | Canvas 2D / `OffscreenCanvas`                                       |
| Background removal | `@imgly/background-removal` (ONNX Runtime Web, WebGPU)              |
| Mask → vector      | `@cadit-app/potrace-ts` (MIT)                                       |
| Offset / boolean   | `@doodle3d/clipper-js`                                              |
| PDF                | `pdf-lib`                                                           |
| Data Matrix        | `bwip-js` (lazy-loaded)                                             |
| Toolchain          | vite-plus for Node, **pnpm** for packages                           |

See [`docs/decisions.md`](docs/decisions.md) for the reasoning behind each choice.

## Getting started

This project is managed with [vite-plus](https://viteplus.dev) (Node) and pnpm.
`vite-plus` shims `node`, `pnpm`, etc. onto your `PATH`.

```sh
pnpm install
pnpm dev          # dev server
pnpm build        # static production build in build/
pnpm preview      # preview the build
pnpm check        # svelte-check + TypeScript
pnpm test         # vitest
```

`pnpm install` requires the `protobufjs` build script to be approved (transitive
dependency of `onnxruntime-web`); this is declared under `allowBuilds` in
`pnpm-workspace.yaml`.

> Since SvelteKit 2.63, the SvelteKit adapter is configured in `vite.config.ts`
> via the `sveltekit()` plugin rather than a separate `svelte.config.js`.

For driving the editor in a real browser (e.g. letting an agent exercise a full
import → segment → export run), see [`docs/chrome.md`](docs/chrome.md).

## Workflow

1. **Import image** — pick a background and/or character image. Each becomes a layer
   fitted to the page; use _Fill page (cover)_ on a background layer.
2. **Remove background** — on a selected layer, runs the segmentation model locally
   and promotes the layer to a _subject_ layer with an alpha mask and a traced cut
   outline. The first run downloads the model (~40 MB, cached afterwards).
3. **Edit the mask** (optional) — toggle **Edit mask** and pick the **Brush** tool
   to _Erase_ or _Restore_ parts of the mask (e.g. keep only a head), the
   **Magic eraser** tool to hover over a colour and erase the connected region
   (e.g. white left in a tight gap), or the **Slice** tool to drag a straight
   line and cut away everything on one side (e.g. level a ragged neck). The
   magic eraser only removes pixels that are currently part of the subject, so
   it cannot leak into the background, and it previews the region in red before
   you click. The slice previews the removed half in red and snaps to
   horizontal/vertical/45° while Shift is held; **Flip side** chooses which half
   goes. Each edit is one undo step.
4. **Adjust the cut** — _Expand_ (mm) grows the outline, _Smoothing_ rounds sharp
   corners. Both update the preview live.
5. **Re-trace** — tune _Threshold_ (or auto/Otsu) and _Despeckle_, then click
   **Re-trace outline**. This re-traces from the stored mask (including brush edits)
   without re-running the model.
6. **Trim shape** — keep the rectangular page or switch to a **Bookmark
   silhouette**: set the base/head split, head layer, notch depth and corner radius.
   The top follows the head's expanded/smoothed outline; artwork is clipped and the
   cut line follows the combined shape.
7. **Page & marks** — set page size (bookmark presets or custom), DPI, bleed, and a
   registration-mark style.
8. **Export** — **PDF** (print), **SVG** (cutter software), or **PNG** (flattened
   raster).
9. **Save** — store the project in this browser under a name, or download it as a
   `.silhouetter.json` file (`Project` menu or `Ctrl`/`Cmd`+`S`).

## Projects (save & open)

The **Project** menu in the toolbar saves and restores work without re-importing
images:

- **Save to browser** — stores the document plus every referenced bitmap by name in
  **IndexedDB**. Object URLs are converted to data URLs so projects survive a
  reload. Named projects are listed in the menu and can be loaded or deleted.
- **Download .json** — the same project as a `.silhouetter.json` file, to keep or
  move between machines.
- **Open .json…** — load a downloaded project, replacing the current document
  (undoable).

`Ctrl`/`Cmd`+`S` saves to the browser under the current project name. IndexedDB is
used rather than `localStorage` because a single imported bitmap becomes a
multi-megabyte base64 data URL, which overflows the ~5 MB `localStorage` quota after
one or two images. IndexedDB stores the structured data directly and has a much
larger quota; the **Download** file remains the way to move projects between
browsers or machines.

## Print model

- Page geometry is stored in **millimetres**; PDF uses points, raster uses the
  document DPI. Conversions live in `src/lib/units.ts`.
- The **trim box** is the finished item. **Bleed** extends the artwork past the trim
  (mirror-edge or solid fill).
- The PDF sets `MediaBox` (media incl. marks), `BleedBox`, and `TrimBox`.
- **Sheet imposition** (optional) lays 2 or 3 copies across a landscape A4 or US
  Letter sheet, centred with a small gutter, and wraps the whole group in a single
  registration-mark set. Enabling **Double-sided** adds a second page that is the
  horizontal mirror of the first, for printing duplex (flip on long edge) so the
  front and back registration and cut lines coincide.
- Per-layer **Mirror on back** (default on) controls the reverse page: artwork
  mirrors through the paper, while layers switched off (logos, wordmarks) keep
  their placement but stay the right way round. The Data Matrix is likewise kept
  readable so it still scans.
- Cut polygons are derived as: source pixels → layer millimetres → **smooth →
  expand** → page millimetres. Smoothing runs before expansion so expansion
  guarantees final clearance.
- For a **bookmark silhouette** the document trim outline is the plain bookmark base
  unioned with the head layer's smoothed + expanded outline; artwork is clipped to
  it (offset outwards by the bleed) and the cut line follows the combined shape.
  PDF's `TrimBox` stays the rectangular bounding box — the vector cut path is the
  authoritative silhouette (SVG is exact).

## Project layout

```
src/lib/
  units.ts            mm / pt / px conversions
  types.ts            document + layer model
  doc.svelte.ts       runes store with snapshot undo/redo
  state.svelte.ts     singleton store + image/mask caches + brush tool state
  actions.ts          import, segment, mask strokes, re-trace, export actions
  image/canvas.ts     leaf canvas helpers (no project imports)
  image/ops.ts        flatten at DPI, mask compositing, bleed, shape clip
  image/magic.ts      magic-eraser colour flood fill
  geometry/transform.ts  source/layer/page point mapping
  geometry/shape.ts   bookmark base + derived document trim outline
  segment/segment.ts  background-removal wrapper
  vector/trace.ts     potrace wrapper + clipper offset/booleans + SVG paths
  vector/smooth.ts    Chaikin polygon smoothing
  marks/              registration-mark generators + Data Matrix
  export/pdf.ts       pdf-lib PDF exporter
  export/impose.ts    landscape multi-up sheet imposition maths
  export/svg.ts       cutter SVG exporter
  export/cut.ts       shared cut-outline builder
  project.ts          project file format (serialise / validate)
  projectStorage.svelte.ts  named projects in localStorage
  components/         Editor, LayerNode, Toolbar, LayerPanel, Inspector, ProjectMenu
src/routes/           SvelteKit page
```

## Licensing

- The project itself has no declared license yet.
- `@imgly/background-removal` is **AGPL-3.0**. It is fine for local/personal use,
  but distributing or hosting this app publicly would trigger AGPL obligations
  (open-source the app or buy a commercial license). Swapping to
  `@huggingface/transformers` with a permissive ONNX model is the escape hatch.
- `esm-potrace-wasm` was deliberately **not** used because it is GPL-2.0;
  `@cadit-app/potrace-ts` (MIT) is used instead.

## Hardware caveats

- **Cricut**: Design Space draws its own Print-Then-Cut sensor marks and warns that
  externally printed PDFs produce mis-sized marks. Upload the **SVG** to Design
  Space rather than printing a PDF.
- **Silhouette Studio**: also manages its own marks for official Print & Cut. Treat
  the generated marks as alignment/third-party fiducials and validate on hardware.

## Deployment headers

`static/_headers` sets `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`
(Netlify / Cloudflare Pages format) to enable `SharedArrayBuffer` for multi-threaded
ONNX inference. WebGPU works without them. Adjust for other hosts as needed.
