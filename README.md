# Silhouetter

A client-side editor for making print-and-cut bookmarks and similar items. Combine
backgrounds and character cut-outs, trace a cut outline around the subject, add
bleed and registration marks, then export a print-ready **PDF** or a cutter-friendly
**SVG**.

Everything runs in the browser — images never leave the device and there is no
server component.

## Stack

| Concern | Choice |
| --- | --- |
| App shell | SvelteKit + `@sveltejs/adapter-static`, client-only (`ssr = false`) |
| Editor / layers | `konva` + `svelte-konva` (Svelte 5 runes) |
| Raster ops | Canvas 2D / `OffscreenCanvas` |
| Background removal | `@imgly/background-removal` (ONNX Runtime Web, WebGPU) |
| Mask → vector | `@cadit-app/potrace-ts` (MIT) |
| Offset / boolean | `@doodle3d/clipper-js` |
| PDF | `pdf-lib` |
| Data Matrix | `bwip-js` (lazy-loaded) |
| Toolchain | vite-plus for Node, **pnpm** for packages |

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

## Workflow

1. **Import image** — pick a background and/or character image. Each becomes a layer
   fitted to the page.
2. **Remove background** — on a selected layer, runs the segmentation model locally
   and promotes the layer to a *subject* layer with an alpha mask and a traced cut
   outline. The first run downloads the model (~40 MB, cached afterwards).
3. **Adjust the cut** — *Expand* (mm) grows the outline, *Smoothing* rounds sharp
   corners. Both update the preview live.
4. **Re-trace** — tune *Threshold* (or auto/Otsu) and *Despeckle*, then click
   **Re-trace outline**. This re-traces from the stored mask without re-running the
   model.
5. **Page & marks** — set page size (bookmark presets or custom), DPI, bleed, and a
   registration-mark style.
6. **Export** — **PDF** (print), **SVG** (cutter software), or **PNG** (flattened
   raster).

## Print model

- Page geometry is stored in **millimetres**; PDF uses points, raster uses the
  document DPI. Conversions live in `src/lib/units.ts`.
- The **trim box** is the finished item. **Bleed** extends the artwork past the trim
  (mirror-edge or solid fill).
- The PDF sets `MediaBox` (media incl. marks), `BleedBox`, and `TrimBox`.
- Cut polygons are derived as: source pixels → layer millimetres → **smooth →
  expand** → page millimetres. Smoothing runs before expansion so expansion
  guarantees final clearance.

## Project layout

```
src/lib/
  units.ts            mm / pt / px conversions
  types.ts            document + layer model
  doc.svelte.ts       runes store with snapshot undo/redo
  state.svelte.ts     singleton store + image/mask caches
  actions.ts          import, segment, re-trace, export actions
  image/ops.ts        flatten at DPI, crop, mask, bleed
  segment/segment.ts  background-removal wrapper
  vector/trace.ts     potrace wrapper + clipper offset + SVG paths
  vector/smooth.ts    Chaikin polygon smoothing
  marks/              registration-mark generators + Data Matrix
  export/pdf.ts       pdf-lib PDF exporter
  export/svg.ts       cutter SVG exporter
  export/cut.ts       shared cut-outline builder
  components/         Editor, LayerNode, Toolbar, LayerPanel, Inspector
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
