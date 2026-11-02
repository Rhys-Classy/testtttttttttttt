# ADR 0001 — Electron + three.js WebGPURenderer

**Status:** accepted

**Decision.** Ship as an Electron app; render with three.js `WebGPURenderer` (WebGPU
backend, automatic WebGL 2 backend).

**Why.** The requirement is local-GPU rendering that behaves the same on every customer
PC. Electron bundles one Chromium, so WebGPU (D3D12 / Metal / Vulkan) and the WebGL 2
fallback are identical everywhere; OS web views (Tauri) are not. three.js gives PBR,
IBL, shadows, GTAO and TSL node materials on both backends from one code path.

**Consequences.** ~100 MB installer. A GPU self-test and device-loss handling are
required because some drivers expose a WebGPU device that does not render — the engine
falls back to WebGL 2 automatically. A native path tracer can be added later for
presentation stills without changing the model.
