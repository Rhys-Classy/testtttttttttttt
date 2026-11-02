// GPU acceleration policy for the desktop app. Called before `app.whenReady()`.
//
// - Always prefer the discrete GPU on dual-GPU laptops.
// - WebGPU is on by default in Chromium on Windows/macOS; Linux needs it enabled.
// - "Force GPU acceleration" (a user setting) ignores Chromium's GPU blocklist for
//   machines whose driver is blocklisted but works fine.

import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface GpuSettings {
  forceGpu: boolean;
}

const settingsPath = () => join(app.getPath('userData'), 'gpu-settings.json');

export function readGpuSettings(): GpuSettings {
  try {
    if (existsSync(settingsPath())) return { forceGpu: false, ...JSON.parse(readFileSync(settingsPath(), 'utf8')) };
  } catch {
    // corrupt settings fall back to defaults
  }
  return { forceGpu: false };
}

export function writeGpuSettings(s: GpuSettings): void {
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(s));
}

export const appliedSwitches: string[] = [];

function sw(name: string, value?: string): void {
  app.commandLine.appendSwitch(name, value);
  appliedSwitches.push(value ? `${name}=${value}` : name);
}

export function configureGpu(): void {
  sw('force_high_performance_gpu');
  // Last resort: if the GPU is unusable or blocklisted, Chromium may still render WebGL
  // with its software rasteriser. Electron disables that by default, which would leave a
  // dead viewport; the app detects software rendering, drops to Low quality and says so.
  sw('enable-unsafe-swiftshader');
  if (process.platform === 'linux') {
    sw('enable-unsafe-webgpu');
    sw('enable-features', 'Vulkan,WebGPU');
  }
  if (readGpuSettings().forceGpu) sw('ignore-gpu-blocklist');
}
