<script lang="ts">
	import { store, DEFAULT_PAGE_SIZES, DPI_PRESETS, brush, getSource } from '$lib/state.svelte';
	import { MARK_STYLES } from '$lib/marks';
	import { retraceLayer, clearMaskStrokes } from '$lib/actions';
	import { bookmarkHasHeadCoverage } from '$lib/geometry/shape';
	import type { BookmarkConfig, Layer, SubjectLayer } from '$lib/types';

	const layer = $derived(store.selected);

	const subjectLayers = $derived(
		store.doc.layers.filter((l): l is SubjectLayer => l.kind === 'subject'),
	);
	const headWarning = $derived(
		store.doc.trimShape === 'bookmark' && !bookmarkHasHeadCoverage(store.doc, getSource),
	);
	const maskStrokeCount = $derived(
		layer && (layer.kind === 'subject' || layer.kind === 'mask') ? layer.maskStrokes.length : 0,
	);

	let tracing = $state(false);
	let traceError = $state('');

	async function onRetrace() {
		if (!layer) return;
		traceError = '';
		tracing = true;
		try {
			await retraceLayer(layer.id);
		} catch (e) {
			traceError = e instanceof Error ? e.message : String(e);
		} finally {
			tracing = false;
		}
	}

	async function onClearStrokes() {
		if (!layer) return;
		await clearMaskStrokes(layer.id);
	}

	function onCoverPage() {
		if (!layer || layer.kind !== 'image') return;
		const src = getSource(layer.sourceId);
		const ratio = src ? src.naturalWidth / src.naturalHeight : layer.width / layer.height;
		let w = store.doc.page.width;
		let h = w / ratio;
		if (h < store.doc.page.height) {
			h = store.doc.page.height;
			w = h * ratio;
		}
		updateLayer({
			x: (store.doc.page.width - w) / 2,
			y: (store.doc.page.height - h) / 2,
			width: w,
			height: h,
			rotation: 0,
		});
	}

	function updateBookmark(patch: Partial<BookmarkConfig>) {
		store.commit((d) => Object.assign(d.bookmark, patch));
	}

	function updateBookmarkLive(patch: Partial<BookmarkConfig>) {
		Object.assign(store.doc.bookmark, patch);
	}

	function setDoc(mutator: (doc: typeof store.doc) => void) {
		store.commit(mutator);
	}

	function pagePresetChanged(event: Event) {
		const value = (event.target as HTMLSelectElement).value;
		const preset = DEFAULT_PAGE_SIZES.find((p) => p.label === value);
		if (!preset) return;
		setDoc((d) => {
			d.page.width = preset.width;
			d.page.height = preset.height;
		});
	}

	// Live-update helpers for range inputs: capture one undo step on pointerdown.
	const begin = () => store.begin();

	function updateLayer(patch: Partial<Layer>) {
		if (!layer) return;
		store.commit((d) => {
			const l = d.layers.find((x) => x.id === layer.id);
			if (l) Object.assign(l, patch);
		});
	}

	function updateLayerLive(patch: Partial<Layer>) {
		if (!layer) return;
		Object.assign(layer, patch);
	}
</script>

<div class="inspector">
	<section>
		<h2>Document</h2>
		<label>
			Name
			<input
				type="text"
				value={store.doc.name}
				onchange={(e) => setDoc((d) => (d.name = e.currentTarget.value))}
			/>
		</label>
		<label>
			Page preset
			<select value="" onchange={pagePresetChanged}>
				<option value="" disabled>Choose…</option>
				{#each DEFAULT_PAGE_SIZES as preset (preset.label)}
					<option value={preset.label}>{preset.label}</option>
				{/each}
			</select>
		</label>
		<div class="row">
			<label>
				Width (mm)
				<input
					type="number"
					min="5"
					step="0.5"
					value={store.doc.page.width}
					onchange={(e) => setDoc((d) => (d.page.width = Number(e.currentTarget.value)))}
				/>
			</label>
			<label>
				Height (mm)
				<input
					type="number"
					min="5"
					step="0.5"
					value={store.doc.page.height}
					onchange={(e) => setDoc((d) => (d.page.height = Number(e.currentTarget.value)))}
				/>
			</label>
		</div>
		<label>
			Output DPI
			<select
				value={store.doc.dpi}
				onchange={(e) => setDoc((d) => (d.dpi = Number(e.currentTarget.value)))}
			>
				{#each DPI_PRESETS as dpi (dpi)}
					<option value={dpi}>{dpi}</option>
				{/each}
			</select>
		</label>
	</section>

	<section>
		<h2>Trim shape</h2>
		<label>
			Shape
			<select
				value={store.doc.trimShape}
				onchange={(e) => setDoc((d) => (d.trimShape = e.currentTarget.value as typeof d.trimShape))}
			>
				<option value="rect">Rectangle</option>
				<option value="bookmark">Bookmark silhouette</option>
			</select>
		</label>
		{#if store.doc.trimShape === 'bookmark'}
			<label>
				Base / head split
				<input
					type="range"
					min="0.05"
					max="0.95"
					step="0.01"
					value={store.doc.bookmark.baseFraction}
					onpointerdown={begin}
					oninput={(e) => updateBookmarkLive({ baseFraction: Number(e.currentTarget.value) })}
				/>
				<span class="value">
					{Math.round((1 - store.doc.bookmark.baseFraction) * 100)}% head ·
					{Math.round(store.doc.bookmark.baseFraction * 100)}% base
				</span>
			</label>
			<label>
				Head layer
				<select
					value={store.doc.bookmark.subjectLayerId ?? ''}
					onchange={(e) => updateBookmark({ subjectLayerId: e.currentTarget.value || null })}
				>
					<option value="">Auto (first traced)</option>
					{#each subjectLayers as s (s.id)}
						<option value={s.id}>{s.name}</option>
					{/each}
				</select>
			</label>
			<div class="row">
				<label>
					Notch depth (mm)
					<input
						type="number"
						min="0"
						step="0.5"
						value={store.doc.bookmark.notchDepthMm}
						onchange={(e) => updateBookmark({ notchDepthMm: Number(e.currentTarget.value) })}
					/>
				</label>
				<label>
					Corner radius (mm)
					<input
						type="number"
						min="0"
						step="0.5"
						value={store.doc.bookmark.cornerRadiusMm}
						onchange={(e) => updateBookmark({ cornerRadiusMm: Number(e.currentTarget.value) })}
					/>
				</label>
			</div>
			{#if headWarning}
				<p class="hint error">
					The head layer has no traced outline yet. Run Remove background and Re-trace outline.
				</p>
			{/if}
			<p class="hint">The top follows the head's expanded + smoothed cut line.</p>
		{/if}
	</section>

	<section>
		<h2>Bleed</h2>
		<label class="checkbox">
			<input
				type="checkbox"
				checked={store.doc.bleed.enabled}
				onchange={(e) => setDoc((d) => (d.bleed.enabled = e.currentTarget.checked))}
			/>
			Enable bleed
		</label>
		<label>
			Amount (mm)
			<input
				type="number"
				min="0"
				max="20"
				step="0.5"
				value={store.doc.bleed.amountMm}
				onchange={(e) => setDoc((d) => (d.bleed.amountMm = Number(e.currentTarget.value)))}
			/>
		</label>
		<label>
			Fill
			<select
				value={store.doc.bleed.mode}
				onchange={(e) => setDoc((d) => (d.bleed.mode = e.currentTarget.value as 'mirror' | 'solid'))}
			>
				<option value="mirror">Mirror edges</option>
				<option value="solid">Solid colour</option>
			</select>
		</label>
		{#if store.doc.bleed.mode === 'solid'}
			<label>
				Colour
				<input
					type="color"
					value={store.doc.bleed.solidColor}
					oninput={(e) => (store.doc.bleed.solidColor = e.currentTarget.value)}
				/>
			</label>
		{/if}
	</section>

	<section>
		<h2>Registration marks</h2>
		<label>
			Style
			<select
				value={store.doc.registration.style}
				onchange={(e) =>
					setDoc((d) => (d.registration.style = e.currentTarget.value as typeof d.registration.style))}
			>
				{#each MARK_STYLES as style (style.value)}
					<option value={style.value}>{style.label}</option>
				{/each}
			</select>
		</label>
		<p class="hint">{MARK_STYLES.find((s) => s.value === store.doc.registration.style)?.description}</p>
		{#if store.doc.registration.style !== 'none'}
			<div class="row">
				<label>
					Margin (mm)
					<input
						type="number"
						min="0"
						step="0.5"
						value={store.doc.registration.marginMm}
						onchange={(e) => setDoc((d) => (d.registration.marginMm = Number(e.currentTarget.value)))}
					/>
				</label>
				<label>
					Size (mm)
					<input
						type="number"
						min="1"
						step="0.5"
						value={store.doc.registration.sizeMm}
						onchange={(e) => setDoc((d) => (d.registration.sizeMm = Number(e.currentTarget.value)))}
					/>
				</label>
			</div>
			<label>
				Line width (mm)
				<input
					type="number"
					min="0.05"
					step="0.05"
					value={store.doc.registration.lineWidthMm}
					onchange={(e) => setDoc((d) => (d.registration.lineWidthMm = Number(e.currentTarget.value)))}
				/>
			</label>
			<label class="checkbox">
				<input
					type="checkbox"
					checked={store.doc.registration.dataMatrix}
					onchange={(e) => setDoc((d) => (d.registration.dataMatrix = e.currentTarget.checked))}
				/>
				Data Matrix
			</label>
			{#if store.doc.registration.dataMatrix}
				<input
					type="text"
					value={store.doc.registration.dataMatrixValue}
					onchange={(e) => setDoc((d) => (d.registration.dataMatrixValue = e.currentTarget.value))}
				/>
			{/if}
		{/if}
	</section>

	<section>
		<h2>Cut line</h2>
		<label class="checkbox">
			<input
				type="checkbox"
				checked={store.doc.showCutLine}
				onchange={(e) => setDoc((d) => (d.showCutLine = e.currentTarget.checked))}
			/>
			Show cut line
		</label>
		<label>
			Colour
			<input
				type="color"
				value={store.doc.cutLineColor}
				oninput={(e) => (store.doc.cutLineColor = e.currentTarget.value)}
			/>
		</label>
	</section>

	{#if layer}
		<section>
			<h2>Layer</h2>
			<label>
				Name
				<input
					type="text"
					value={layer.name}
					onchange={(e) => updateLayer({ name: e.currentTarget.value })}
				/>
			</label>
			<label>
				Opacity
				<input
					type="range"
					min="0"
					max="1"
					step="0.01"
					value={layer.opacity}
					onpointerdown={begin}
					oninput={(e) => updateLayerLive({ opacity: Number(e.currentTarget.value) })}
				/>
			</label>
			<div class="row">
				<label>
					X (mm)
					<input
						type="number"
						step="0.5"
						value={layer.x}
						onchange={(e) => updateLayer({ x: Number(e.currentTarget.value) })}
					/>
				</label>
				<label>
					Y (mm)
					<input
						type="number"
						step="0.5"
						value={layer.y}
						onchange={(e) => updateLayer({ y: Number(e.currentTarget.value) })}
					/>
				</label>
			</div>
			<div class="row">
				<label>
					W (mm)
					<input
						type="number"
						min="1"
						step="0.5"
						value={layer.width}
						onchange={(e) => updateLayer({ width: Number(e.currentTarget.value) })}
					/>
				</label>
				<label>
					H (mm)
					<input
						type="number"
						min="1"
						step="0.5"
						value={layer.height}
						onchange={(e) => updateLayer({ height: Number(e.currentTarget.value) })}
					/>
				</label>
			</div>
			<label>
				Rotation (°)
				<input
					type="number"
					step="1"
					value={layer.rotation}
					onchange={(e) => updateLayer({ rotation: Number(e.currentTarget.value) })}
				/>
			</label>

			{#if layer.kind === 'image'}
				<button onclick={onCoverPage}>Fill page (cover)</button>
			{/if}

			{#if layer.kind === 'subject'}
				<label>
					Expand (mm)
					<input
						type="range"
						min="0"
						max="10"
						step="0.1"
						value={layer.cutExpandMm}
						onpointerdown={begin}
						oninput={(e) => updateLayerLive({ cutExpandMm: Number(e.currentTarget.value) })}
					/>
					<span class="value">{layer.cutExpandMm.toFixed(1)} mm</span>
				</label>
				<label>
					Smoothing
					<input
						type="range"
						min="0"
						max="1"
						step="0.05"
						value={layer.cutSmooth}
						onpointerdown={begin}
						oninput={(e) => updateLayerLive({ cutSmooth: Number(e.currentTarget.value) })}
					/>
					<span class="value">{Math.round(layer.cutSmooth * 100)}%</span>
				</label>

				<h3>Trace</h3>
				<label>
					Despeckle (px)
					<input
						type="range"
						min="0"
						max="200"
						step="1"
						value={layer.traceDespeckle}
						onpointerdown={begin}
						oninput={(e) => updateLayerLive({ traceDespeckle: Number(e.currentTarget.value) })}
					/>
					<span class="value">{layer.traceDespeckle} px</span>
				</label>
				<label class="checkbox">
					<input
						type="checkbox"
						checked={layer.traceAutoThreshold}
						onchange={(e) => updateLayer({ traceAutoThreshold: e.currentTarget.checked })}
					/>
					Auto threshold
				</label>
				{#if !layer.traceAutoThreshold}
					<label>
						Threshold
						<input
							type="range"
							min="1"
							max="254"
							step="1"
							value={layer.traceThreshold}
							onpointerdown={begin}
							oninput={(e) => updateLayerLive({ traceThreshold: Number(e.currentTarget.value) })}
						/>
						<span class="value">{layer.traceThreshold}</span>
					</label>
				{/if}
				<button onclick={onRetrace} disabled={tracing || !layer.maskDataUrl}>
					{tracing ? 'Tracing…' : 'Re-trace outline'}
				</button>
				{#if traceError}
					<p class="hint error">{traceError}</p>
				{:else}
					<p class="hint">Re-traces from the stored mask without re-running the model.</p>
				{/if}

				<h3>Mask brush</h3>
				<button class:active={brush.active} onclick={() => (brush.active = !brush.active)}>
					{brush.active ? 'Stop painting' : 'Paint mask'}
				</button>
				<div class="row">
					<label>
						Mode
						<select
							value={brush.mode}
							onchange={(e) => (brush.mode = e.currentTarget.value as 'erase' | 'restore')}
						>
							<option value="erase">Erase</option>
							<option value="restore">Restore</option>
						</select>
					</label>
					<label>
						Size (mm)
						<input
							type="range"
							min="0.5"
							max="20"
							step="0.5"
							value={brush.radiusMm}
							oninput={(e) => (brush.radiusMm = Number(e.currentTarget.value))}
						/>
					</label>
				</div>
				<button onclick={onClearStrokes} disabled={maskStrokeCount === 0}>
					Clear brush edits ({maskStrokeCount})
				</button>
				<p class="hint">
					Paint the mask, then Re-trace outline to update the cut and bookmark shape.
				</p>
			{:else if layer.kind === 'mask'}
				<h3>Mask</h3>
				<p class="hint">
					Painted areas are punched out of every layer. Use the eye in the Layers panel to
					enable or disable the mask.
				</p>
				<h3>Mask brush</h3>
				<button class:active={brush.active} onclick={() => (brush.active = !brush.active)}>
					{brush.active ? 'Stop painting' : 'Paint mask'}
				</button>
				<div class="row">
					<label>
						Brush
						<select
							value={brush.mode}
							onchange={(e) => (brush.mode = e.currentTarget.value as 'erase' | 'restore')}
						>
							<option value="erase">Subtract</option>
							<option value="restore">Add</option>
						</select>
					</label>
					<label>
						Size (mm)
						<input
							type="range"
							min="0.5"
							max="20"
							step="0.5"
							value={brush.radiusMm}
							oninput={(e) => (brush.radiusMm = Number(e.currentTarget.value))}
						/>
					</label>
				</div>
				<button onclick={onClearStrokes} disabled={maskStrokeCount === 0}>
					Clear brush edits ({maskStrokeCount})
				</button>
				<p class="hint">
					Subtract punches a hole through all layers; Add fills it back in. The cut line follows
					automatically.
				</p>
			{/if}
		</section>
	{/if}
</div>

<style>
	.inspector {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 0.75rem;
	}
	section {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	h2 {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
		margin: 0;
	}
	h3 {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
		margin: 0.35rem 0 0;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.78rem;
		color: var(--muted);
	}
	label.checkbox {
		flex-direction: row;
		align-items: center;
		gap: 0.4rem;
	}
	input,
	select {
		font: inherit;
		color: var(--fg);
	}
	.row {
		display: flex;
		gap: 0.5rem;
	}
	.row label {
		flex: 1;
	}
	.hint {
		font-size: 0.7rem;
		color: var(--muted);
		margin: 0;
		line-height: 1.35;
	}
	.hint.error {
		color: #b91c1c;
	}
	.value {
		font-size: 0.72rem;
		color: var(--muted);
	}
	button.active {
		background: color-mix(in srgb, var(--accent) 18%, transparent);
		border-color: var(--accent);
	}
</style>
