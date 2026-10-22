export type Effect = 'gravity' | 'zigzag' | 'fracture';
export type Detail = 'coarse' | 'normal' | 'fine';
export type ElementKind = 'text' | 'shape' | 'region' | 'fragment';
export type Point = { x: number; y: number };
export interface PosterElement {
  id: string;
  label: string;
  kind: ElementKind;
  sprite: HTMLCanvasElement;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface PosterAsset {
  width: number;
  height: number;
  source: HTMLCanvasElement;
  background: HTMLCanvasElement;
  color: string;
  elements: PosterElement[];
  method: string;
  pageCount: number;
}
export interface Settings {
  effect: Effect;
  intensity: number;
  gravity: number;
  restitution: number;
  showPaths: boolean;
  showLabels: boolean;
  paused: boolean;
  original: boolean;
}
export interface ElementTelemetry {
  id: string;
  label: string;
  x: number;
  y: number;
  originX: number;
  originY: number;
  dx: number;
  dy: number;
  rotation: number;
  speed: number;
  warp: number;
  path: Point[];
}
export interface Telemetry {
  elements: ElementTelemetry[];
  energy: number;
  active: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  effect: 'gravity',
  intensity: 55,
  gravity: 65,
  restitution: 45,
  showPaths: true,
  showLabels: false,
  paused: false,
  original: false,
};
