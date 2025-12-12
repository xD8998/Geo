
export enum ObjectType {
  DELETE = 0,
  BLOCK = 1,
  SPIKE = 2,
  TOOL = 3, // Selection tool
  PAD = 4,
  ORB = 5,
  DECO = 6,
  PORTAL = 7,
  TRIGGER = 8,
  START_POS = 9,
}

export enum GameMode {
  EDITOR = 'EDITOR',
  PLAYTEST = 'PLAYTEST',
  PAUSED = 'PAUSED',
  VERIFY = 'VERIFY',
  VERIFY_PAUSED = 'VERIFY_PAUSED',
  COMPLETE = 'COMPLETE',
}

export enum VehicleMode {
  CUBE = 'CUBE',
  SHIP = 'SHIP',
}

export interface LevelSettings {
  bgColorTop: string;
  bgColorBottom: string;
  groundColor: string;
  lineColor: string;
  startMode: VehicleMode;
  startReverseGravity?: boolean;
}

export interface LevelData {
  settings: LevelSettings;
  objects: LevelObject[];
}

export type TriggerTarget = 'bgColorTop' | 'bgColorBottom' | 'groundColor' | 'lineColor';

export interface TriggerData {
  target: TriggerTarget;
  color: string;
  duration: number; // in seconds
  touchTrigger?: boolean;
}

export interface StartPosData {
  mode: VehicleMode;
  reverseGravity: boolean;
  enabled: boolean;
}

export interface LevelObject {
  id: string;
  x: number; // Grid coordinates
  y: number; // Grid coordinates
  type: ObjectType;
  subtype: number;
  rotation?: number; // Degrees 0-360
  triggerData?: TriggerData; // Only for triggers
  startPosData?: StartPosData; // Only for start pos
}

export interface Player {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  rotation: number;
  onGround: boolean;
  dead: boolean;
  finished: boolean;
  vehicle: VehicleMode;
  gravityReversed: boolean;
  mirrored: boolean;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  type?: 'circle' | 'ring'; // Ring for pulse effect
  size?: number;
}

export interface Point {
  x: number;
  y: number;
}
