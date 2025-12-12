
import { LevelSettings, VehicleMode } from './types';

export const TILE_SIZE = 40;
export const GRAVITY = 0.95;
export const JUMP_FORCE = -13.8; 
export const PLAYER_SPEED = 6.4;
export const TERMINAL_VELOCITY = 18;
export const FLOOR_LEVEL_GRID = 12; // The y-index where the floor starts
export const FLOOR_Y = FLOOR_LEVEL_GRID * TILE_SIZE;

// Ship Constants
export const SHIP_GRAVITY = 0.4;
export const SHIP_THRUST = -0.8;
export const SHIP_TERMINAL_VELOCITY = 10;

export const PAD_FORCE_PINK = -10.0; // Mini
export const PAD_FORCE_YELLOW = -16.5; // Normal+
export const PAD_FORCE_RED = -22.0; // Big

export const ORB_FORCE_PINK = -9.0;
export const ORB_FORCE_YELLOW = -15.0;
export const ORB_FORCE_RED = -21.0;

// Colors
export const COLORS = {
  bgGradientTop: '#004e92',
  bgGradientBottom: '#000428',
  gridLine: 'rgba(255, 255, 255, 0.08)',
  groundFill: '#000000',
  groundLine: '#ffffff',
  playerFill: '#ffd700',
  playerDetail: '#00ffff',
  trail: '#00ff00',
  objBlockFill: 'rgba(0,0,0,0.5)',
  objBlockStroke: '#00ffff',
  objBrickFill: '#b7410e',
  objSpikeFill: '#222222',
  objSpikeStroke: '#dddddd',
  objPadPink: '#ff66cc',
  objPadYellow: '#ffff00',
  objPadRed: '#ff0000',
  objPadCyan: '#00ffff',
  objPadRing: '#ffffff',
  selectionStroke: '#00ff00', // Reverted to Green
  selectionFill: 'rgba(0, 255, 0, 0.2)', // Reverted to Green tint
  pasteStroke: '#0088ff', // Blue for paste
  pasteFill: 'rgba(0, 136, 255, 0.2)', // Blue tint for paste
  endWall: 'rgba(255, 255, 255, 0.1)',
  objPortalGreen: '#00ff00',
  objPortalPink: '#ff66cc',
  objPortalYellow: '#ffff00',
  objPortalBlue: '#00ffff',
  objPortalOrange: '#ffaa00',
  objPortalBlueMirror: '#00aaff',
  shipCeiling: 'rgba(255, 255, 255, 0.3)',
  triggerLine: 'rgba(0, 200, 255, 0.5)',
  triggerDurationLine: 'rgba(150, 150, 150, 0.5)',
};

export const DEFAULT_LEVEL_SETTINGS: LevelSettings = {
  bgColorTop: COLORS.bgGradientTop,
  bgColorBottom: COLORS.bgGradientBottom,
  groundColor: COLORS.groundFill,
  lineColor: COLORS.groundLine,
  startMode: VehicleMode.CUBE,
  startReverseGravity: false
};
