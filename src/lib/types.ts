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
  showPaths: boolean;
  showLabels: boolean;
  paused: boolean;
  original: boolean;
}
export interface ElementTelemetry {
  areaWeight: number;
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
  compression: number;
  damage: number;
  scaleX: number;
  scaleY: number;
  path: Point[];
}
export interface Telemetry {
  elements: ElementTelemetry[];
  energy: number;
  active: boolean;
  impact: number;
  deformation: number;
}
export const DEFAULT_SETTINGS: Settings = {
  showPaths: false,
  showLabels: false,
  paused: false,
  original: false,
};
