<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import LayerPanel from '$lib/components/LayerPanel.svelte';
	import Editor from '$lib/components/Editor.svelte';
	import Inspector from '$lib/components/Inspector.svelte';
</script>

<div class="app">
	<Toolbar />
	<main>
		<aside class="left"><LayerPanel /></aside>
		<section class="center"><Editor /></section>
		<aside class="right"><Inspector /></aside>
	</main>
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
		overflow: hidden;
	}
	main {
		flex: 1;
		display: grid;
		grid-template-columns: 220px minmax(0, 1fr) 280px;
		min-height: 0;
	}
	aside {
		background: var(--panel);
		border-right: 1px solid var(--border);
		overflow-y: auto;
	}
	aside.right {
		border-right: none;
		border-left: 1px solid var(--border);
	}
	.center {
		min-width: 0;
		min-height: 0;
		display: flex;
	}
</style>
