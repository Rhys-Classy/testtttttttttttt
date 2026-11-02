// GPU render engine. three.js WebGPURenderer drives the local GPU through WebGPU and
// falls back to WebGL 2 automatically on hardware/drivers without WebGPU.
//
// Design rules:
//  • Render on demand: frames are drawn only when something changed (model, camera,
//    lighting). Idle = 0 % GPU, which matters on laptops.
//  • Geometry comes from the engine's build results; meshes are rebuilt per item only
//    when that item's build changed, and just re-positioned while dragging.
//  • Quality presets scale pixel ratio, shadow resolution and ambient occlusion so the
//    same project runs on integrated graphics and renders beautifully on a big GPU.

import * as THREE from 'three/webgpu';
import { builtinAOContext, mrt, normalView, pass, screenUV } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  boundsOf,
  degToRad,
  wallPieces,
  type DerivedRoom,
  type Item,
  type ItemBuild,
  type LayerId,
  type Placement,
  type ProjectDocument,
  type QualityPreset,
  type RenderSettings,
  type Vec2,
  type WallFace,
} from '@engine/index';
import type { GpuStatus, RenderStats, Selection, ViewMode } from '../state/store';
import { MaterialCache } from './materials3d';
import { applyPlacement, buildItemObject, buildSelectionObject, extrudePolygon, fromThree, openingObject, S, toThree, wallObject, type ItemObject, type PickInfo } from './meshes';
import { QUALITY, type QualitySettings } from './quality';

export interface SyncInput {
  doc: ProjectDocument;
  derived: DerivedRoom;
  selection: Selection;
  hoverId: string | null;
  layers: Record<LayerId, boolean>;
  showEdges: boolean;
  view: ViewMode;
  elevationFace: WallFace | null;
}

interface ItemEntry {
  build: ItemBuild;
  item: Item;
  obj: ItemObject;
  layer: LayerId;
}

export interface RoomBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  height: number;
}

const LIGHTING = {
  studio: { bg: 0x1e2125, env: 0.95, hemi: 0.35, sun: 0xffffff, sunScale: 0.55 },
  daylight: { bg: 0xbfc8d1, env: 0.65, hemi: 0.45, sun: 0xfff3e2, sunScale: 1 },
  evening: { bg: 0x17161d, env: 0.22, hemi: 0.12, sun: 0xffa865, sunScale: 0.4 },
} as const;

export class GpuSelfTestError extends Error {}

export function itemLayer(item: Item): LayerId {
  if (item.kind === 'panel') return item.panelType === 'benchtop' || item.panelType === 'splashback' ? 'tops' : 'panels';
  if (item.category === 'wall') return 'wall';
  if (item.category === 'tall' || item.category === 'wardrobe' || item.category === 'furniture') return 'tall';
  return 'base';
}

export class RenderEngine {
  renderer!: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly persp = new THREE.PerspectiveCamera(45, 1, 0.05, 300);
  readonly ortho = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.01, 400);
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.persp;
  orbit!: OrbitControls;
  orthoControls!: OrbitControls;
  walk!: PointerLockControls;
  backend: 'webgpu' | 'webgl2' = 'webgl2';
  aoAvailable = true;

  private pipeline: THREE.RenderPipeline | null = null;
  private materials = new MaterialCache();
  private itemsGroup = new THREE.Group();
  private wallsGroup = new THREE.Group();
  private openingsGroup = new THREE.Group();
  private floorGroup = new THREE.Group();
  private ledGroup = new THREE.Group();
  private selectionGroup = new THREE.Group();
  private items = new Map<string, ItemEntry>();
  private wallMeshes = new Map<string, THREE.Mesh[]>();
  private openingObjs = new Map<string, { wallId: string; group: THREE.Group }>();
  private disposers: (() => void)[] = [];
  private selectionDispose: (() => void) | null = null;
  private selectionKey = '';
  private selState: { build: ItemBuild | null } = { build: null };
  private wallsKey: unknown[] = [];
  private ledKey: unknown[] = [];
  private hemi = new THREE.HemisphereLight(0xffffff, 0x8a7f72, 0.4);
  private sun = new THREE.DirectionalLight(0xffffff, 2);
  private envTexture: THREE.Texture | null = null;
  private quality: QualitySettings = QUALITY.high;
  private qualityName: QualityPreset = 'high';
  private needsRender = true;
  private size = { w: 1, h: 1 };
  private view: ViewMode = '3d';
  private faces: WallFace[] = [];
  private interior = new Set<string>();
  private elevationFace: WallFace | null = null;
  private lastInput: SyncInput | null = null;
  private keys = new Set<string>();
  private lastTick = performance.now();
  private frames = 0;
  private fpsT0 = performance.now();
  private lastFrameMs = 0;
  private bounds: RoomBounds = { minX: 0, minY: 0, maxX: 4000, maxY: 3000, height: 2400 };
  private disposed = false;
  private renderSettings: RenderSettings | null = null;

  onAfterRender: (() => void) | null = null;
  onStats: ((s: RenderStats) => void) | null = null;
  onWalkLockChange: ((locked: boolean) => void) | null = null;

  onDeviceLost: ((message: string) => void) | null = null;

  async init(canvas: HTMLCanvasElement, gpu: GpuStatus, quality: QualityPreset, preferWebGL = false): Promise<void> {
    const forceWebGL = preferWebGL || gpu.backend !== 'webgpu';
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: !gpu.software, forceWebGL, alpha: false });
    // A lost GPU device (driver reset, GPU removed, out of memory) is reported to the app,
    // which rebuilds the viewport on the WebGL 2 backend.
    (this.renderer as unknown as { onDeviceLost: (info: { message?: string }) => void }).onDeviceLost = (info) => {
      this.reportLost(info?.message ?? 'GPU device lost');
    };
    await this.renderer.init();
    if (this.disposed) return;
    const backend = (this.renderer as unknown as { backend: { isWebGPUBackend?: boolean } }).backend;
    this.backend = backend.isWebGPUBackend ? 'webgpu' : 'webgl2';
    if (this.backend === 'webgpu') {
      if (!(await this.selfTest())) throw new GpuSelfTestError('The WebGPU device did not produce an image.');
      // Some drivers lose the device shortly after start without firing device.lost.
      window.addEventListener('unhandledrejection', this.onRejection);
      this.healthTimer = window.setTimeout(() => void this.healthCheck(), 2500);
    }
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTexture;
    pmrem.dispose();

    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.scene.add(this.floorGroup, this.wallsGroup, this.openingsGroup, this.itemsGroup, this.ledGroup, this.selectionGroup);

    const el = canvas;
    this.orbit = new OrbitControls(this.persp, el);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.maxPolarAngle = Math.PI / 2 - 0.01;
    this.orbit.minDistance = 0.3;
    this.orbit.maxDistance = 60;
    this.orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.orbit.addEventListener('change', () => this.requestRender());

    this.orthoControls = new OrbitControls(this.ortho, el);
    this.orthoControls.enableRotate = false;
    this.orthoControls.screenSpacePanning = true;
    this.orthoControls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.orthoControls.zoomToCursor = true;
    this.orthoControls.addEventListener('change', () => this.requestRender());
    this.orthoControls.enabled = false;

    this.walk = new PointerLockControls(this.persp, el);
    this.walk.addEventListener('lock', () => this.onWalkLockChange?.(true));
    this.walk.addEventListener('unlock', () => this.onWalkLockChange?.(false));
    this.walk.addEventListener('change', () => this.requestRender());
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);

    this.setQuality(quality);
    await this.renderer.setAnimationLoop(this.tick);
  }

  /**
   * Render a known colour into a tiny target and read it back. Some drivers (and headless
   * software adapters) hand out a WebGPU device that never rasterises; detecting that up
   * front lets the app fall back to WebGL 2 instead of showing a black viewport.
   */
  private async selfTest(): Promise<boolean> {
    const rt = new THREE.RenderTarget(4, 4);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xff0000);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    try {
      this.renderer.setRenderTarget(rt);
      this.renderer.render(scene, cam);
      this.renderer.setRenderTarget(null);
      const read = this.renderer.readRenderTargetPixelsAsync(rt, 0, 0, 4, 4) as Promise<ArrayLike<number>>;
      const timeout = new Promise<null>((ok) => setTimeout(() => ok(null), 4000));
      const px = await Promise.race([read, timeout]);
      if (!px || !(px[0] > 200 && px[1] < 60 && px[2] < 60)) return false;
      // Presentation: draw to the canvas and copy it back in the same task. A device that
      // rasterises but never presents reads back transparent black here.
      this.renderer.render(scene, cam);
      const el = this.renderer.domElement;
      const probe = document.createElement('canvas');
      probe.width = probe.height = 1;
      const g = probe.getContext('2d', { willReadFrequently: true });
      if (!g) return true;
      g.drawImage(el, Math.floor(el.width / 2), Math.floor(el.height / 2), 1, 1, 0, 0, 1, 1);
      const c = g.getImageData(0, 0, 1, 1).data;
      return c[0] > 200 && c[1] < 60 && c[2] < 60 && c[3] > 200;
    } catch {
      return false;
    } finally {
      rt.dispose();
    }
  }

  private healthTimer = 0;
  private lost = false;

  private reportLost(message: string): void {
    if (this.lost || this.disposed) return;
    this.lost = true;
    this.onDeviceLost?.(message);
  }

  private onRejection = (e: PromiseRejectionEvent): void => {
    const msg = String((e.reason as { message?: string })?.message ?? e.reason ?? '');
    if (/Instance (dropped|reference)|device (is )?lost|Device was destroyed/i.test(msg)) this.reportLost(msg);
  };

  private async healthCheck(): Promise<void> {
    if (this.disposed || this.backend !== 'webgpu') return;
    if (!(await this.selfTest())) this.reportLost('WebGPU stopped producing images');
  }

  private onKey = (e: KeyboardEvent): void => {
    if (this.view !== 'walk') return;
    const k = e.key.toLowerCase();
    if (e.type === 'keydown') this.keys.add(k);
    else this.keys.delete(k);
    if (e.type === 'keyup' && e.key === 'Shift') this.keys.delete('shift');
  };

  requestRender = (): void => {
    this.needsRender = true;
  };

  get qualityPreset(): QualityPreset {
    return this.qualityName;
  }

  setQuality(q: QualityPreset): void {
    this.qualityName = q;
    this.quality = QUALITY[q];
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.sun.shadow.radius = this.quality.softShadows ? 4 : 1;
    this.sun.castShadow = this.quality.shadows;
    this.sun.shadow.mapSize.set(this.quality.shadowMapSize, this.quality.shadowMapSize);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null as unknown as THREE.RenderTarget;
    const maxAniso = (this.renderer as unknown as { getMaxAnisotropy?: () => number }).getMaxAnisotropy?.() ?? 4;
    this.materials.configure(this.quality.textureSize, Math.min(8, maxAniso));
    this.buildPipeline();
    if (this.lastInput) this.rebuildAll();
    this.requestRender();
  }

  private buildPipeline(): void {
    this.pipeline?.dispose();
    this.pipeline = null;
    if (!this.quality.ao || !this.aoAvailable || !this.renderer) return;
    try {
      const p = new THREE.RenderPipeline(this.renderer);
      const prePass = pass(this.scene, this.camera);
      prePass.setMRT(mrt({ output: normalView }));
      const normal = prePass.getTextureNode();
      const depth = prePass.getTextureNode('depth');
      const scenePass = pass(this.scene, this.camera);
      const aoPass = ao(depth, normal, this.camera);
      aoPass.resolutionScale = this.quality.aoScale;
      aoPass.radius.value = 0.3;
      aoPass.thickness.value = 0.8;
      scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
      p.outputNode = scenePass;
      this.pipeline = p;
    } catch (e) {
      console.warn('Ambient occlusion unavailable, continuing without it.', e);
      this.aoAvailable = false;
      this.pipeline = null;
    }
  }

  setSize(w: number, h: number): void {
    if (!this.renderer) return;
    this.size = { w: Math.max(1, w), h: Math.max(1, h) };
    this.renderer.setSize(this.size.w, this.size.h, false);
    this.persp.aspect = this.size.w / this.size.h;
    this.persp.updateProjectionMatrix();
    this.fitOrthoAspect();
    this.requestRender();
  }

  private fitOrthoAspect(): void {
    const halfH = (this.ortho.top - this.ortho.bottom) / 2;
    const cx = (this.ortho.left + this.ortho.right) / 2;
    const aspect = this.size.w / this.size.h;
    this.ortho.left = cx - halfH * aspect;
    this.ortho.right = cx + halfH * aspect;
    this.ortho.updateProjectionMatrix();
  }

  // ───────────────────────────── Scene sync ─────────────────────────────

  sync(input: SyncInput): void {
    if (!this.renderer) return;
    const prev = this.lastInput;
    this.lastInput = input;
    const { doc, derived } = input;
    const room = derived.room;
    this.faces = derived.faces;
    this.interior = derived.interiorFaceIds;
    this.elevationFace = input.elevationFace;
    const materialsChanged = !prev || prev.doc.materials !== doc.materials || prev.showEdges !== input.showEdges || prev.doc.materialDefaults !== doc.materialDefaults;
    if (materialsChanged && prev) this.clearItems();

    // Walls, openings and floor
    const wk = [room.walls, room.openings, room.wallMaterialId, room.floorMaterialId, doc.materials];
    if (wk.some((v, i) => v !== this.wallsKey[i])) {
      this.wallsKey = wk;
      this.rebuildRoom(input);
    }

    // Items
    const live = new Set<string>();
    for (const item of room.items) {
      live.add(item.id);
      const build = derived.builds.get(item.id);
      if (!build) continue;
      const entry = this.items.get(item.id);
      if (entry && entry.build === build) {
        if (entry.item.placement !== item.placement) applyPlacement(entry.obj.group, item.placement);
        entry.item = item;
        entry.layer = itemLayer(item);
        continue;
      }
      if (entry) this.removeItem(item.id);
      const obj = buildItemObject(build, item.placement, derived.materials, this.materials, doc.materialDefaults.handle, {
        shadows: true,
        edges: input.showEdges || this.view !== '3d',
      });
      this.itemsGroup.add(obj.group);
      this.items.set(item.id, { build, item, obj, layer: itemLayer(item) });
    }
    for (const id of [...this.items.keys()]) if (!live.has(id)) this.removeItem(id);

    // Visibility, hover and selection
    for (const [id, e] of this.items) {
      e.obj.group.visible = input.layers[e.layer];
      if (e.obj.edges) e.obj.edges.material = id === input.hoverId && input.selection?.id !== id ? this.materials.edgeHover : this.materials.edge;
    }
    this.wallsGroup.visible = input.layers.walls;
    this.openingsGroup.visible = input.layers.openings;
    this.syncSelection(input);
    this.syncLighting(doc.render, input);
    this.updateBounds(input);
    this.requestRender();
  }

  private rebuildAll(): void {
    const input = this.lastInput;
    if (!input) return;
    this.clearItems();
    this.wallsKey = [];
    this.ledKey = [];
    this.selectionKey = '';
    this.lastInput = null;
    this.sync(input);
  }

  private clearItems(): void {
    for (const id of [...this.items.keys()]) this.removeItem(id);
  }

  private removeItem(id: string): void {
    const e = this.items.get(id);
    if (!e) return;
    this.itemsGroup.remove(e.obj.group);
    e.obj.dispose();
    this.items.delete(id);
  }

  private rebuildRoom(input: SyncInput): void {
    for (const d of this.disposers) d();
    this.disposers = [];
    this.wallsGroup.clear();
    this.openingsGroup.clear();
    this.floorGroup.clear();
    this.wallMeshes.clear();
    this.openingObjs.clear();
    const { derived } = input;
    const room = derived.room;
    const mats = derived.materials;
    const wallMat = this.materials.get(mats.get(room.wallMaterialId));
    for (const g of derived.walls.values()) {
      const w = wallObject(g, wallPieces(g, room.openings), wallMat, true);
      this.wallsGroup.add(w.group);
      this.wallMeshes.set(g.wall.id, w.meshes);
      this.disposers.push(w.dispose);
    }
    const frame = this.materials.get(mats.get('metal-matt-black'));
    const glass = this.materials.get(mats.get('glass-clear'));
    const leaf = this.materials.get(mats.get('ven-natural-oak'));
    for (const o of room.openings) {
      const g = derived.walls.get(o.wallId);
      if (!g) continue;
      const obj = openingObject(o, g, frame, glass, leaf);
      this.openingsGroup.add(obj.group);
      this.openingObjs.set(o.id, { wallId: o.wallId, group: obj.group });
      this.disposers.push(obj.dispose);
    }
    // Floor slab: the room loop if closed, otherwise a pad around everything.
    let poly: Vec2[] | null = derived.floorPolygon;
    if (!poly) {
      const pts = room.walls.flatMap((w) => [w.start, w.end]);
      const b = pts.length ? boundsOf(pts) : { minX: -2000, minY: -2000, maxX: 4000, maxY: 3000 };
      poly = [
        { x: b.minX - 1000, y: b.minY - 1000 },
        { x: b.maxX + 1000, y: b.minY - 1000 },
        { x: b.maxX + 1000, y: b.maxY + 1000 },
        { x: b.minX - 1000, y: b.maxY + 1000 },
      ];
    }
    const floorGeo = extrudePolygon(poly, -30, 0);
    const floor = new THREE.Mesh(floorGeo, this.materials.get(mats.get(room.floorMaterialId)));
    floor.receiveShadow = true;
    floor.name = 'floor';
    this.floorGroup.add(floor);
    this.disposers.push(() => floorGeo.dispose());
    // Ground beyond the room so plan/elevation views have context.
    const groundGeo = new THREE.PlaneGeometry(200, 200);
    const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ color: 0x2a2d32, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.031;
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.floorGroup.add(ground);
    this.disposers.push(() => {
      groundGeo.dispose();
      (ground.material as THREE.Material).dispose();
    });
  }

  private syncSelection(input: SyncInput): void {
    const sel = input.selection;
    const entry = sel?.kind === 'item' ? this.items.get(sel.id) : undefined;
    const st = this.selState;
    const key = sel ? `${sel.kind}:${sel.id}:${this.view}` : '';
    if (key !== this.selectionKey || (entry?.build ?? null) !== st.build) {
      this.selectionKey = key;
      st.build = entry?.build ?? null;
      this.selectionDispose?.();
      this.selectionDispose = null;
      this.selectionGroup.clear();
      if (entry && this.view !== 'walk') {
        const s = buildSelectionObject(entry.build, entry.item.placement, this.materials);
        this.selectionGroup.add(s.group);
        this.selectionDispose = s.dispose;
      }
      for (const [id, meshes] of this.wallMeshes) for (const m of meshes) m.userData.selected = sel?.kind === 'wall' && sel.id === id;
    }
    if (entry && this.selectionGroup.children[0]) applyPlacement(this.selectionGroup.children[0], entry.item.placement);
  }

  private syncLighting(r: RenderSettings, input: SyncInput): void {
    this.renderSettings = r;
    const L = LIGHTING[r.lighting];
    this.scene.background = new THREE.Color(this.view === 'plan' || this.view === 'front' || this.view === 'side' ? 0x15171b : L.bg);
    this.scene.environmentIntensity = L.env;
    this.hemi.intensity = L.hemi;
    this.sun.color.set(L.sun);
    this.sun.intensity = r.sunIntensity * L.sunScale;
    this.renderer.toneMappingExposure = r.exposure;
    // Under-cabinet LED strips: one emissive strip and one light per wall cabinet (capped).
    const on = r.underCabinetLights || r.lighting === 'evening';
    const key = [on, input.derived.room.items];
    if (key.some((v, i) => v !== this.ledKey[i])) {
      this.ledKey = key;
      for (const c of [...this.ledGroup.children]) {
        this.ledGroup.remove(c);
        if (c instanceof THREE.Mesh) c.geometry.dispose();
      }
      if (on) {
        const wallCabs = input.derived.room.items.filter((i) => i.kind === 'cabinet' && i.category === 'wall').slice(0, 16);
        for (const c of wallCabs) {
          if (c.kind !== 'cabinet') continue;
          const g = new THREE.Group();
          applyPlacement(g, c.placement);
          const strip = new THREE.Mesh(new THREE.BoxGeometry((c.params.width - 40) * S, 0.004, 0.012), this.materials.led);
          strip.position.copy(toThree(c.params.width / 2, 40, -2));
          const light = new THREE.PointLight(0xffe2b8, 0.9, 1.6, 2);
          light.position.copy(toThree(c.params.width / 2, 60, -40));
          g.add(strip, light);
          this.ledGroup.add(g);
        }
      }
    }
  }

  private updateBounds(input: SyncInput): void {
    const room = input.derived.room;
    const pts: Vec2[] = [];
    for (const g of input.derived.walls.values()) pts.push(...g.outline);
    for (const it of room.items) pts.push({ x: it.placement.x, y: it.placement.y });
    const b = pts.length ? boundsOf(pts) : { minX: 0, minY: 0, maxX: 4000, maxY: 3000 };
    this.bounds = { ...b, height: room.ceilingHeight };
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const r = Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2 + 1500;
    const el = degToRad(input.doc.render.sunElevation);
    const az = degToRad(input.doc.render.sunAzimuth);
    const dir = { x: Math.cos(el) * Math.cos(az), y: Math.cos(el) * Math.sin(az), z: Math.sin(el) };
    const target = toThree(cx, cy, 0);
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).add(new THREE.Vector3(dir.x, dir.z, -dir.y).multiplyScalar(r * S * 2));
    const cam = this.sun.shadow.camera;
    cam.left = -r * S;
    cam.right = r * S;
    cam.top = r * S;
    cam.bottom = -r * S;
    cam.near = 0.1;
    cam.far = r * S * 4;
    cam.updateProjectionMatrix();
  }

  // ───────────────────────────── Views & cameras ─────────────────────────────

  get roomBounds(): RoomBounds {
    return this.bounds;
  }

  setView(view: ViewMode, face: WallFace | null): void {
    const prevView = this.view;
    this.view = view;
    this.elevationFace = face;
    if (this.walk.isLocked && view !== 'walk') this.walk.unlock();
    const ortho = view === 'plan' || view === 'front' || view === 'side';
    const nextCam = ortho ? this.ortho : this.persp;
    const camChanged = nextCam !== this.camera;
    this.camera = nextCam;
    this.orbit.enabled = view === '3d';
    this.orthoControls.enabled = ortho;
    this.frame();
    if (camChanged || prevView !== view) this.buildPipeline();
    if (this.lastInput) {
      const edgesBefore = this.lastInput.showEdges || prevView !== '3d';
      const edgesAfter = this.lastInput.showEdges || view !== '3d';
      if (edgesBefore !== edgesAfter) this.rebuildAll();
      else this.sync({ ...this.lastInput, view, elevationFace: face });
    }
    this.requestRender();
  }

  /** Frame the room for the current view. */
  frame(): void {
    const b = this.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const w = b.maxX - b.minX;
    const d = b.maxY - b.minY;
    const aspect = this.size.w / this.size.h;
    if (this.view === '3d') {
      const r = Math.hypot(w, d, b.height) / 2;
      const dist = (r / Math.sin(degToRad(this.persp.fov / 2))) * 0.95;
      const az = degToRad(-125);
      const el = degToRad(32);
      const target = toThree(cx, cy, 900);
      this.persp.position.copy(target).add(new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), -Math.cos(el) * Math.sin(az)).multiplyScalar(dist * S));
      this.orbit.target.copy(target);
      this.persp.up.set(0, 1, 0);
      this.orbit.update();
    } else if (this.view === 'walk') {
      this.persp.position.copy(toThree(cx, b.minY + d * 0.85, 1600));
      this.persp.up.set(0, 1, 0);
      this.persp.lookAt(toThree(cx, b.minY, 1300));
    } else if (this.view === 'plan') {
      this.setOrtho(w * 1.15, d * 1.15, aspect);
      this.ortho.position.copy(toThree(cx, cy, 20000));
      this.ortho.up.set(0, 0, -1);
      this.ortho.lookAt(toThree(cx, cy, 0));
      this.orthoControls.target.copy(toThree(cx, cy, 0));
      this.ortho.near = 1;
      this.ortho.far = 40;
    } else {
      const f = this.elevationFace;
      if (!f) return;
      const xAxis = { x: -f.normal.y, y: f.normal.x };
      // Depth of the room in front of this face (to the far wall).
      const depth = Math.max(1000, ...this.faces.map((o) => (o.wallId === f.wallId ? 0 : Math.max(0, (o.a.x - f.a.x) * f.normal.x + (o.a.y - f.a.y) * f.normal.y))));
      const H = b.height;
      if (this.view === 'front') {
        const mid = { x: (f.a.x + f.b.x) / 2, y: (f.a.y + f.b.y) / 2 };
        this.setOrtho(f.length * 1.15, H * 1.2, aspect);
        const camPos = { x: mid.x + f.normal.x * (depth - 60), y: mid.y + f.normal.y * (depth - 60) };
        this.ortho.position.copy(toThree(camPos.x, camPos.y, H / 2));
        this.ortho.up.set(0, 1, 0);
        this.ortho.lookAt(toThree(mid.x, mid.y, H / 2));
        this.orthoControls.target.copy(toThree(mid.x, mid.y, H / 2));
        this.ortho.near = 0.01;
        this.ortho.far = (depth + 500) * S;
      } else {
        // Side elevation: look along the face's x axis from the left end.
        const u0 = Math.min(0, (f.b.x - f.a.x) * xAxis.x + (f.b.y - f.a.y) * xAxis.y);
        const start = { x: f.a.x + xAxis.x * (u0 + 40), y: f.a.y + xAxis.y * (u0 + 40) };
        const mid = { x: start.x + f.normal.x * depth * 0.5, y: start.y + f.normal.y * depth * 0.5 };
        this.setOrtho(depth * 1.15, H * 1.2, aspect);
        this.ortho.position.copy(toThree(mid.x, mid.y, H / 2));
        this.ortho.up.set(0, 1, 0);
        const look = { x: mid.x + xAxis.x * 1000, y: mid.y + xAxis.y * 1000 };
        this.ortho.lookAt(toThree(look.x, look.y, H / 2));
        this.orthoControls.target.copy(toThree(look.x, look.y, H / 2));
        this.ortho.near = 0.01;
        this.ortho.far = (f.length + 500) * S;
      }
    }
    this.ortho.zoom = 1;
    this.ortho.updateProjectionMatrix();
    this.orthoControls.update();
    this.requestRender();
  }

  private setOrtho(wMm: number, hMm: number, aspect: number): void {
    const halfH = Math.max(hMm / 2, wMm / 2 / aspect) * S;
    this.ortho.left = -halfH * aspect;
    this.ortho.right = halfH * aspect;
    this.ortho.top = halfH;
    this.ortho.bottom = -halfH;
  }

  /** Hide walls between the camera and the room (3D), or everything but the elevation wall. */
  private updateWallCutaway(): void {
    const camMm = fromThree(this.camera.position);
    const hidden = new Set<string>();
    if (this.view === '3d') {
      for (const f of this.faces) {
        if (!this.interior.has(f.id)) continue;
        const s = (camMm.x - f.a.x) * f.normal.x + (camMm.y - f.a.y) * f.normal.y;
        if (s < 0) hidden.add(f.wallId);
      }
    } else if ((this.view === 'front' || this.view === 'side') && this.elevationFace) {
      for (const id of this.wallMeshes.keys()) if (id !== this.elevationFace.wallId) hidden.add(id);
    }
    for (const [id, meshes] of this.wallMeshes) {
      const ghost = hidden.has(id);
      for (const m of meshes) {
        m.visible = !(ghost && this.view !== '3d');
        if (m.userData.baseMat === undefined) m.userData.baseMat = m.material;
        m.material = ghost ? this.materials.ghostWall : (m.userData.baseMat as THREE.Material);
        m.castShadow = !ghost;
      }
    }
    for (const o of this.openingObjs.values()) o.group.visible = !hidden.has(o.wallId);
  }

  // ───────────────────────────── Loop ─────────────────────────────

  private tick = (): void => {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    if (this.view === '3d' && this.orbit.update()) this.needsRender = true;
    if (this.view === 'walk' && this.walk.isLocked) this.stepWalk(dt);
    if (!this.needsRender) return;
    this.needsRender = false;
    this.updateWallCutaway();
    const t0 = performance.now();
    if (this.pipeline && this.view !== 'walk') this.pipeline.render();
    else this.renderer.render(this.scene, this.camera);
    this.lastFrameMs = performance.now() - t0;
    this.onAfterRender?.();
    this.frames++;
    if (now - this.fpsT0 > 500) {
      const info = this.renderer.info.render as unknown as { drawCalls?: number; calls?: number; triangles: number };
      this.onStats?.({ fps: Math.round((this.frames * 1000) / (now - this.fpsT0)), drawCalls: info.drawCalls ?? info.calls ?? 0, triangles: info.triangles, frameMs: this.lastFrameMs });
      this.frames = 0;
      this.fpsT0 = now;
    }
  };

  private stepWalk(dt: number): void {
    const speed = (this.keys.has('shift') ? 3 : 1.4) * dt;
    const fwd = (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0) - (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0);
    const right = (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0);
    if (!fwd && !right) return;
    this.walk.moveForward(fwd * speed);
    this.walk.moveRight(right * speed);
    const b = this.bounds;
    const p = fromThree(this.persp.position);
    const x = Math.min(b.maxX - 250, Math.max(b.minX + 250, p.x));
    const y = Math.min(b.maxY - 250, Math.max(b.minY + 250, p.y));
    this.persp.position.copy(toThree(x, y, 1600));
    this.needsRender = true;
  }

  lockWalk(): void {
    if (this.view === 'walk' && !this.walk.isLocked) this.walk.lock();
  }

  // ───────────────────────────── Picking ─────────────────────────────

  private raycaster = new THREE.Raycaster();

  private rayFromClient(clientX: number, clientY: number): THREE.Raycaster {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster;
  }

  pick(clientX: number, clientY: number): PickInfo | null {
    const rc = this.rayFromClient(clientX, clientY);
    const handles = this.selectionGroup.children.flatMap((g) => g.children.filter((c) => c.userData.pick?.kind === 'handle'));
    const hh = rc.intersectObjects(handles, false);
    if (hh.length) return hh[0].object.userData.pick as PickInfo;
    const targets: THREE.Object3D[] = [];
    for (const e of this.items.values()) if (e.obj.group.visible) targets.push(...e.obj.pickables);
    if (this.openingsGroup.visible) for (const o of this.openingObjs.values()) if (o.group.visible) targets.push(...o.group.children);
    if (this.wallsGroup.visible) for (const ms of this.wallMeshes.values()) for (const m of ms) if (m.visible && m.material !== this.materials.ghostWall) targets.push(m);
    const hits = rc.intersectObjects(targets, false);
    for (const h of hits) {
      const p = h.object.userData.pick as PickInfo | undefined;
      if (p) return p;
    }
    return null;
  }

  /**
   * First wall surface under the pointer (vertical faces only), with the face normal in
   * plan. Used so that dropping onto a far wall in 3D attaches to its room side instead
   * of landing on the floor behind it.
   */
  wallSurfaceHit(clientX: number, clientY: number): { point: Vec2; normal: Vec2; distance: number } | null {
    if (!this.wallsGroup.visible) return null;
    const rc = this.rayFromClient(clientX, clientY);
    const targets: THREE.Object3D[] = [];
    for (const ms of this.wallMeshes.values()) for (const m of ms) if (m.visible && m.material !== this.materials.ghostWall) targets.push(m);
    for (const h of rc.intersectObjects(targets, false)) {
      const n = h.face?.normal;
      if (!n || Math.abs(n.y) > 0.5) continue;
      const p = fromThree(h.point);
      const len = Math.hypot(n.x, n.z) || 1;
      return { point: { x: p.x, y: p.y }, normal: { x: n.x / len, y: -n.z / len }, distance: h.distance };
    }
    return null;
  }

  /** Distance along the pointer ray to the horizontal plane at z (mm), or null. */
  planeDistance(clientX: number, clientY: number, z: number): number | null {
    const rc = this.rayFromClient(clientX, clientY);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -z * S);
    const hit = new THREE.Vector3();
    if (!rc.ray.intersectPlane(plane, hit)) return null;
    return hit.distanceTo(rc.ray.origin);
  }

  /** Intersect the pointer ray with the horizontal plane at height z (mm). Plan coords. */
  planPoint(clientX: number, clientY: number, z = 0): Vec2 | null {
    const rc = this.rayFromClient(clientX, clientY);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -z * S);
    const hit = new THREE.Vector3();
    if (!rc.ray.intersectPlane(plane, hit)) return null;
    const p = fromThree(hit);
    return { x: p.x, y: p.y };
  }

  /** Intersect with a vertical plane through `point` (mm) facing the camera; returns height z (mm). */
  verticalHit(clientX: number, clientY: number, point: { x: number; y: number; z: number }): number | null {
    const rc = this.rayFromClient(clientX, clientY);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) return null;
    dir.normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(dir, toThree(point.x, point.y, point.z));
    const hit = new THREE.Vector3();
    if (!rc.ray.intersectPlane(plane, hit)) return null;
    return fromThree(hit).z;
  }

  /** Intersect the pointer ray with any plane (engine mm coordinates). */
  hitPlane(clientX: number, clientY: number, normal: { x: number; y: number; z: number }, point: { x: number; y: number; z: number }): { x: number; y: number; z: number } | null {
    const rc = this.rayFromClient(clientX, clientY);
    const n = new THREE.Vector3(normal.x, normal.z, -normal.y).normalize();
    if (Math.abs(n.dot(rc.ray.direction)) < 1e-4) return null;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, toThree(point.x, point.y, point.z));
    const hit = new THREE.Vector3();
    if (!rc.ray.intersectPlane(plane, hit)) return null;
    return fromThree(hit);
  }

  /** View direction in engine coordinates (unit). */
  viewDirection(): { x: number; y: number; z: number } {
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    return { x: d.x, y: -d.z, z: d.y };
  }

  /** Project a world point (mm) to canvas pixels; null when behind the camera. */
  project(p: { x: number; y: number; z: number }): { x: number; y: number } | null {
    const v = toThree(p.x, p.y, p.z).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: ((v.x + 1) / 2) * this.size.w, y: ((1 - v.y) / 2) * this.size.h };
  }

  /** Millimetres per screen pixel at a point (for screen-constant offsets in dimensions). */
  mmPerPixel(p: { x: number; y: number; z: number }): number {
    if (this.camera instanceof THREE.OrthographicCamera) {
      return ((this.ortho.top - this.ortho.bottom) / this.ortho.zoom / this.size.h) / S;
    }
    const d = this.persp.position.distanceTo(toThree(p.x, p.y, p.z));
    return ((2 * d * Math.tan(degToRad(this.persp.fov / 2))) / this.size.h) / S;
  }

  setControlsEnabled(on: boolean): void {
    this.orbit.enabled = on && this.view === '3d';
    this.orthoControls.enabled = on && (this.view === 'plan' || this.view === 'front' || this.view === 'side');
  }

  get currentView(): ViewMode {
    return this.view;
  }

  // ───────────────────────────── Capture ─────────────────────────────

  /** Render a still at the given pixel size using Ultra settings; returns a PNG data URL. */
  async capture(width: number, height: number, hideSelection = true): Promise<string> {
    const prevQuality = this.qualityName;
    const prevPR = this.renderer.getPixelRatio();
    const prevSize = { ...this.size };
    const selVisible = this.selectionGroup.visible;
    if (hideSelection) this.selectionGroup.visible = false;
    if (prevQuality !== 'ultra') this.setQuality('ultra');
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.persp.aspect = width / height;
    this.persp.updateProjectionMatrix();
    this.size = { w: width, h: height };
    this.fitOrthoAspect();
    this.updateWallCutaway();
    // Shadow maps and AO buffers resize lazily: render twice so both are current.
    for (let i = 0; i < 2; i++) {
      if (this.pipeline && this.view !== 'walk') this.pipeline.render();
      else this.renderer.render(this.scene, this.camera);
    }
    const url = this.renderer.domElement.toDataURL('image/png');
    this.selectionGroup.visible = selVisible;
    if (prevQuality !== 'ultra') this.setQuality(prevQuality);
    this.renderer.setPixelRatio(prevPR);
    this.setSize(prevSize.w, prevSize.h);
    this.requestRender();
    return url;
  }

  /** Current 3D camera in mm (for saving views). */
  cameraState(): { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; fov: number } {
    return { position: fromThree(this.persp.position), target: fromThree(this.orbit.target), fov: this.persp.fov };
  }

  restoreCamera(c: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; fov: number }): void {
    this.persp.position.copy(toThree(c.position.x, c.position.y, c.position.z));
    this.orbit.target.copy(toThree(c.target.x, c.target.y, c.target.z));
    this.persp.fov = c.fov;
    this.persp.updateProjectionMatrix();
    this.orbit.update();
    this.requestRender();
  }

  private disposeCalled = false;

  dispose(): void {
    if (this.disposeCalled) return;
    this.disposeCalled = true;
    this.disposed = true;
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('unhandledrejection', this.onRejection);
    window.clearTimeout(this.healthTimer);
    if (!this.renderer) return;
    void this.renderer.setAnimationLoop(null);
    this.orbit?.dispose();
    this.orthoControls?.dispose();
    this.walk?.dispose();
    this.clearItems();
    for (const d of this.disposers) d();
    this.selectionDispose?.();
    this.pipeline?.dispose();
    this.materials.clear();
    this.envTexture?.dispose();
    this.renderer.dispose();
  }
}

export type { Placement };
