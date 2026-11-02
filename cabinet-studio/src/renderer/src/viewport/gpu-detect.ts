// Detect the local GPU and pick a sensible starting quality tier.
// WebGPU is used when an adapter is available; otherwise three.js falls back to WebGL 2.

import type { GpuStatus } from '../state/store';

interface MinimalAdapterInfo {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
  isFallbackAdapter?: boolean;
}
interface MinimalAdapter {
  info?: MinimalAdapterInfo;
  isFallbackAdapter?: boolean;
  limits: { maxTextureDimension2D: number };
  features: { has(name: string): boolean };
}
interface MinimalGpu {
  requestAdapter(opts?: { powerPreference?: 'high-performance' | 'low-power' }): Promise<MinimalAdapter | null>;
}

/**
 * Chromium/Dawn tears down the WebGPU instance when every adapter reference has been
 * garbage-collected, which can leave the renderer's device silently dead. Keep the
 * detection adapter alive for the lifetime of the page.
 */
let keepAlive: MinimalAdapter | null = null;

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;
const HIGH = /nvidia|geforce|rtx|gtx|quadro|radeon|amd|apple m\d|apple gpu|arc /i;
const INTEGRATED = /intel|uhd|iris|hd graphics|vega \d|radeon\(tm\) graphics/i;
const VENDOR_NAMES: Record<string, string> = { nvidia: 'NVIDIA', intel: 'Intel', amd: 'AMD', apple: 'Apple', qualcomm: 'Qualcomm', arm: 'Arm' };

function webglInfo(): { ok: boolean; renderer: string; vendor: string; maxTexture: number } {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return { ok: false, renderer: '', vendor: '', maxTexture: 0 };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    const vendor = String(gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR));
    const maxTexture = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { ok: true, renderer, vendor, maxTexture };
  } catch {
    return { ok: false, renderer: '', vendor: '', maxTexture: 0 };
  }
}

export async function detectGpu(): Promise<GpuStatus> {
  const details: Record<string, string> = {};
  const gl = webglInfo();
  details['WebGL 2'] = gl.ok ? `${gl.renderer} (${gl.vendor})` : 'unavailable';
  const gpu = (navigator as Navigator & { gpu?: MinimalGpu }).gpu;
  if (gpu) {
    try {
      // Some driver stacks never resolve requestAdapter(); don't let that block startup.
      const adapter = await Promise.race([
        gpu.requestAdapter({ powerPreference: 'high-performance' }),
        new Promise<null>((ok) => setTimeout(() => ok(null), 4000)),
      ]);
      if (adapter) {
        keepAlive = adapter;
        void keepAlive;
        const info = adapter.info ?? {};
        const vendor = info.vendor ? (VENDOR_NAMES[info.vendor.toLowerCase()] ?? info.vendor) : '';
        const name = [vendor, info.description || info.device, info.architecture ? `(${info.architecture})` : ''].filter(Boolean).join(' ') || 'WebGPU adapter';
        const fallback = !!(adapter.isFallbackAdapter ?? info.isFallbackAdapter);
        const software = fallback || SOFTWARE.test(`${name} ${gl.renderer}`);
        details['WebGPU adapter'] = name;
        details['Fallback adapter'] = fallback ? 'yes' : 'no';
        details['Max texture'] = String(adapter.limits.maxTextureDimension2D);
        details['Timestamp queries'] = adapter.features.has('timestamp-query') ? 'yes' : 'no';
        // Judge the device WebGPU actually gave us, not the browser's display GPU.
        const integrated = !software && INTEGRATED.test(`${info.vendor ?? ''} ${name}`) && !HIGH.test(name);
        return {
          backend: 'webgpu',
          adapter: name,
          vendor,
          software,
          integrated,
          displayGpu: gl.renderer,
          tier: software ? 'low' : integrated ? 'medium' : HIGH.test(name) ? 'high' : 'medium',
          maxTextureSize: adapter.limits.maxTextureDimension2D,
          details,
        };
      }
      details['WebGPU adapter'] = 'none returned';
    } catch (e) {
      details['WebGPU adapter'] = `error: ${(e as Error).message}`;
    }
  } else {
    details['WebGPU'] = 'not exposed by this runtime';
  }
  if (gl.ok) {
    const software = SOFTWARE.test(gl.renderer);
    return {
      backend: 'webgl2',
      adapter: gl.renderer,
      vendor: gl.vendor,
      software,
      integrated: !software && INTEGRATED.test(gl.renderer) && !HIGH.test(gl.renderer),
      displayGpu: gl.renderer,
      tier: software ? 'low' : HIGH.test(gl.renderer) ? 'high' : 'medium',
      maxTextureSize: gl.maxTexture,
      details,
    };
  }
  return { backend: 'none', adapter: 'none', vendor: '', software: true, integrated: false, displayGpu: '', tier: 'low', maxTextureSize: 0, details, error: 'No GPU graphics API is available.' };
}
