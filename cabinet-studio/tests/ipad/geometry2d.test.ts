import { describe, expect, it } from 'vitest';
import { fitView, gridLines, pinch, pointInPolygon, screenToWorld, worldToScreen, zoomAt } from '../../src/renderer/src/ipad/geometry2d';

const size = { w: 800, h: 600 };
const v = { cx: 1000, cy: 500, scale: 0.2 };

describe('geometry2d', () => {
  it('round-trips world and screen, y up', () => {
    const p = { x: 1234, y: 777 };
    const q = screenToWorld(v, size, worldToScreen(v, size, p));
    expect(q.x).toBeCloseTo(p.x);
    expect(q.y).toBeCloseTo(p.y);
    expect(worldToScreen(v, size, { x: 1000, y: 500 })).toEqual({ x: 400, y: 300 });
    expect(worldToScreen(v, size, { x: 1000, y: 600 }).y).toBeLessThan(300);
  });
  it('fits bounds with padding', () => {
    const f = fitView({ minX: 0, minY: 0, maxX: 4000, maxY: 3000 }, size, 40);
    expect(f.cx).toBe(2000);
    expect(f.cy).toBe(1500);
    expect(f.scale).toBeCloseTo(Math.min(720 / 4000, 520 / 3000));
  });
  it('point in polygon', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, sq)).toBe(false);
  });
  it('zoomAt keeps the anchor fixed', () => {
    const at = { x: 100, y: 200 };
    const w0 = screenToWorld(v, size, at);
    const z = zoomAt(v, size, at, 2);
    expect(z.scale).toBeCloseTo(0.4);
    const w1 = screenToWorld(z, size, at);
    expect(w1.x).toBeCloseTo(w0.x);
    expect(w1.y).toBeCloseTo(w0.y);
  });
  it('pinch scales by finger distance and follows the centroid', () => {
    const prev: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 300, y: 300 }, { x: 500, y: 300 }];
    const next: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 350, y: 320 }, { x: 750, y: 320 }];
    const anchor = screenToWorld(v, size, { x: 400, y: 300 });
    const r = pinch(v, size, prev, next);
    expect(r.scale).toBeCloseTo(0.4);
    const back = worldToScreen(r, size, anchor);
    expect(back.x).toBeCloseTo(550);
    expect(back.y).toBeCloseTo(320);
  });
  it('grid hides when too dense', () => {
    expect(gridLines(0, 1000, 100, 0.01)).toEqual([]);
    expect(gridLines(0, 300, 100, 0.1)).toEqual([0, 100, 200, 300]);
  });
});
