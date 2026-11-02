import type { QualityPreset } from '@engine/index';

export interface QualitySettings {
  label: string;
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  softShadows: boolean;
  ao: boolean;
  /** GTAO resolution relative to the canvas. */
  aoScale: number;
  textureSize: number;
}

export const QUALITY: Record<QualityPreset, QualitySettings> = {
  low: { label: 'Low — integrated / older GPUs', maxPixelRatio: 1, shadows: false, shadowMapSize: 512, softShadows: false, ao: false, aoScale: 0.5, textureSize: 512 },
  medium: { label: 'Medium — balanced', maxPixelRatio: 1.25, shadows: true, shadowMapSize: 1024, softShadows: true, ao: false, aoScale: 0.5, textureSize: 1024 },
  high: { label: 'High — dedicated GPU', maxPixelRatio: 2, shadows: true, shadowMapSize: 2048, softShadows: true, ao: true, aoScale: 0.5, textureSize: 1024 },
  ultra: { label: 'Ultra — presentation', maxPixelRatio: 2, shadows: true, shadowMapSize: 4096, softShadows: true, ao: true, aoScale: 1, textureSize: 2048 },
};

export const QUALITY_ORDER: QualityPreset[] = ['low', 'medium', 'high', 'ultra'];
