// Client-only application: no server rendering, all image processing happens
// in the browser. The static adapter emits a fallback shell for SPA routing.
export const ssr = false;
export const prerender = true;
