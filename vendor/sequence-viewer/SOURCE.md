# Upstream runtime

The vendor sources come from OpenAI's Biological Sequence & Alignment Viewer
0.1.53 marketplace bundle. The source copies are unmodified. The build script
`scripts/patch-viewer.mjs` stages the CSS and patches the browser bundle to
honor fixed wrapping and bound per-line feature tracks. The generated server
and browser bundle also share a private command that flushes a source-bound
checkpoint before moving an oversized viewer.
The OpenAI copyright and license and the bundled dependency notices are
included. OpenAI telemetry is disabled by using a local no-op logger.
