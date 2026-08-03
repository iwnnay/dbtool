// The debug UI is fully client-side (cytoscape, DOMPurify, localStorage,
// performance) — render it on the client only, like the old core UI's
// `ssr = false`. Endpoints under /api are unaffected (these options scope to the
// debug page subtree).
export const ssr = false;
export const prerender = false;
