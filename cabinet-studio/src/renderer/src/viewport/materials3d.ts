// Project materials → GPU PBR materials (cached). One three.js material per project
// material, shared by every part, keeps draw-call state changes low.

import * as THREE from 'three/webgpu';
import type { Id, MaterialDef } from '@engine/index';
import { proceduralTexture } from './textures';

export class MaterialCache {
  private cache = new Map<Id, { def: MaterialDef; mat: THREE.MeshPhysicalMaterial }>();
  private textures: THREE.Texture[] = [];
  readonly edge = new THREE.LineBasicMaterial({ color: 0x15181c, transparent: true, opacity: 0.55 });
  readonly edgeSelected = new THREE.LineBasicMaterial({ color: 0x3d8bff, depthTest: false, transparent: true });
  readonly edgeHover = new THREE.LineBasicMaterial({ color: 0x7fb2ff, transparent: true, opacity: 0.9 });
  readonly invalid = new THREE.MeshBasicMaterial({ color: 0xff4d4f, wireframe: true });
  readonly handle = new THREE.MeshBasicMaterial({ color: 0x3d8bff, depthTest: false, transparent: true, opacity: 0.95 });
  readonly appliance = new THREE.MeshPhysicalMaterial({ color: 0x0b0c0e, roughness: 0.08, metalness: 0.2, clearcoat: 1 });
  readonly ghostWall = new THREE.MeshStandardMaterial({ color: 0xd9d4cc, roughness: 0.95, transparent: true, opacity: 0.12, depthWrite: false });
  readonly wallCap = new THREE.MeshBasicMaterial({ color: 0x3a3f46 });
  readonly led = new THREE.MeshBasicMaterial({ color: 0xfff1d6 });
  readonly guide = new THREE.LineBasicMaterial({ color: 0x3d8bff, depthTest: false, transparent: true });
  readonly preview = new THREE.MeshBasicMaterial({ color: 0x3d8bff, transparent: true, opacity: 0.35, depthTest: false });
  private textureSize = 1024;
  private anisotropy = 4;

  configure(textureSize: number, anisotropy: number): void {
    const changed = textureSize !== this.textureSize;
    this.textureSize = textureSize;
    this.anisotropy = anisotropy;
    if (changed) this.clear();
  }

  get(def: MaterialDef | undefined): THREE.MeshPhysicalMaterial {
    if (!def) return this.fallback();
    const hit = this.cache.get(def.id);
    if (hit && hit.def === def) return hit.mat;
    if (hit) hit.mat.dispose();
    const mat = this.create(def);
    this.cache.set(def.id, { def, mat });
    return mat;
  }

  private fallbackMat: THREE.MeshPhysicalMaterial | null = null;
  private fallback(): THREE.MeshPhysicalMaterial {
    return (this.fallbackMat ??= new THREE.MeshPhysicalMaterial({ color: 0xff00ff, roughness: 0.6 }));
  }

  private create(def: MaterialDef): THREE.MeshPhysicalMaterial {
    const a = def.appearance;
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(a.color),
      roughness: a.roughness,
      metalness: a.metalness,
      clearcoat: a.clearcoat ?? 0,
      clearcoatRoughness: 0.12,
      name: def.name,
    });
    const repeat = 1000 / (a.textureScale ?? 1000);
    const setup = (t: THREE.Texture, srgb: boolean) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat, repeat);
      t.anisotropy = this.anisotropy;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.needsUpdate = true;
      this.textures.push(t);
      return t;
    };
    if (a.kind === 'glass') {
      mat.transparent = true;
      mat.opacity = a.opacity ?? 0.3;
      mat.depthWrite = false;
      mat.side = THREE.DoubleSide;
    } else if (a.kind === 'image' && a.imageDataUrl) {
      mat.color.set(0xffffff);
      const tex = new THREE.TextureLoader().load(a.imageDataUrl, () => (mat.needsUpdate = true));
      mat.map = setup(tex, true);
    } else {
      const tc = proceduralTexture(a, this.textureSize);
      if (tc) {
        mat.color.set(0xffffff);
        mat.map = setup(new THREE.CanvasTexture(tc.color), true);
        if (tc.roughness) {
          mat.roughnessMap = setup(new THREE.CanvasTexture(tc.roughness), false);
          mat.roughness = 1;
        }
      }
    }
    return mat;
  }

  clear(): void {
    for (const { mat } of this.cache.values()) mat.dispose();
    for (const t of this.textures) t.dispose();
    this.cache.clear();
    this.textures = [];
  }
}
