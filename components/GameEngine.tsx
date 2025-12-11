import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { GameMode, LevelObject, Player, Camera, Particle, Point, ObjectType, VehicleMode, LevelSettings, LevelData, TriggerTarget } from '../types';
import { TILE_SIZE, GRAVITY, JUMP_FORCE, PLAYER_SPEED, TERMINAL_VELOCITY, FLOOR_Y, COLORS, PAD_FORCE_PINK, PAD_FORCE_YELLOW, PAD_FORCE_RED, ORB_FORCE_PINK, ORB_FORCE_YELLOW, ORB_FORCE_RED, FLOOR_LEVEL_GRID, SHIP_GRAVITY, SHIP_THRUST, SHIP_TERMINAL_VELOCITY, DEFAULT_LEVEL_SETTINGS } from '../constants';

interface GameEngineProps {
  mode: GameMode;
  onModeChange: (mode: GameMode) => void;
  selectedTool: { type: ObjectType; subtype: number };
  onSelectionChange: (count: number, hasBlock: boolean, selectedId?: string) => void;
  showHitboxes: boolean;
  onHistoryChange: (canUndo: boolean, canRedo: boolean) => void;
}

export interface GameEngineRef {
  setLevel: (data: any, keepHistory?: boolean) => void;
  getLevel: () => LevelData;
  moveSelection: (dx: number, dy: number) => void;
  rotateSelection: (angle: number, relative: boolean) => void;
  deleteSelection: () => void;
  deselectAll: () => void;
  clearLevel: () => void;
  duplicateSelection: () => void;
  resetPlayer: (forVerify: boolean) => void;
  undo: () => void;
  redo: () => void;
  updateSettings: (settings: Partial<LevelSettings>) => void;
  updateSelectedTrigger: (data: any) => void;
  updateSelectedStartPos: (data: any) => void;
  getSelectedObject: () => LevelObject | undefined;
}

interface ColorEffect {
    target: TriggerTarget;
    startColor: string;
    endColor: string;
    startTime: number;
    duration: number; // in frames
}

// Helper for Polygon Intersection (SAT)
const checkPolygonInteract = (poly1: {x:number, y:number}[], rect2: {x:number, y:number, w:number, h:number}) => {
    // Convert rect2 to polygon
    const poly2 = [
        { x: rect2.x, y: rect2.y },
        { x: rect2.x + rect2.w, y: rect2.y },
        { x: rect2.x + rect2.w, y: rect2.y + rect2.h },
        { x: rect2.x, y: rect2.y + rect2.h }
    ];

    const polygons = [poly1, poly2];
    
    for (let i = 0; i < polygons.length; i++) {
        const polygon = polygons[i];
        for (let j = 0; j < polygon.length; j++) {
            const p1 = polygon[j];
            const p2 = polygon[(j + 1) % polygon.length];
            
            const normal = { x: p2.y - p1.y, y: p1.x - p2.x };
            
            let minA = Infinity, maxA = -Infinity;
            for (const p of poly1) {
                const projected = normal.x * p.x + normal.y * p.y;
                if (projected < minA) minA = projected;
                if (projected > maxA) maxA = projected;
            }
            
            let minB = Infinity, maxB = -Infinity;
            for (const p of poly2) {
                const projected = normal.x * p.x + normal.y * p.y;
                if (projected < minB) minB = projected;
                if (projected > maxB) maxB = projected;
            }
            
            if (maxA < minB || maxB < minA) return false;
        }
    }
    return true;
};

const GameEngine = forwardRef<GameEngineRef, GameEngineProps>(({ mode, onModeChange, selectedTool, onSelectionChange, showHitboxes, onHistoryChange }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  
  // Mutable Game State
  const levelData = useRef<LevelObject[]>([]);
  const levelSettings = useRef<LevelSettings>({ ...DEFAULT_LEVEL_SETTINGS });
  // The colors currently being displayed (affected by triggers)
  const displaySettings = useRef<LevelSettings>({ ...DEFAULT_LEVEL_SETTINGS });
  
  const selectedObjects = useRef<Set<string>>(new Set());
  const isPastedSelection = useRef<boolean>(false);
  const clipboard = useRef<LevelObject[]>([]);
  const trail = useRef<Point[]>([]);
  const deathMarkers = useRef<Point[]>([]);
  const particles = useRef<Particle[]>([]);
  
  // Active Color Effects
  const activeEffects = useRef<ColorEffect[]>([]);
  const triggeredIds = useRef<Set<string>>(new Set());
  const usedObjectIds = useRef<Set<string>>(new Set());
  
  // Undo/Redo History
  const history = useRef<string[]>([]);
  const historyIndex = useRef<number>(-1);

  const player = useRef<Player>({
    x: 0, y: 0, w: 36, h: 36,
    vx: 0, vy: 0, rotation: 0,
    onGround: false, dead: false, finished: false,
    vehicle: VehicleMode.CUBE,
    gravityReversed: false
  });
  
  const activeFloorY = useRef<number>(FLOOR_Y);
  const activeCeilingY = useRef<number>(-99999);
  
  const targetFloorY = useRef<number>(FLOOR_Y);
  const targetCeilingY = useRef<number>(-99999);

  const camera = useRef<Camera>({ x: 0, y: 0, zoom: 1.2 });
  
  // Input State
  const mouse = useRef({ x: 0, y: 0, isDown: false, isRightDown: false, dragStartX: 0, dragStartY: 0 });
  const keys = useRef<{ [key: string]: boolean }>({});
  const prevInputState = useRef<boolean>(false); 
  const hasInputUsed = useRef<boolean>(false);
  const boxSelectStart = useRef<Point | null>(null);
  
  // Logic State
  const finishWallX = useRef<number>(999999);
  const isSuckedIntoWall = useRef<boolean>(false);
  const modeRef = useRef<GameMode>(mode); 
  const selectedToolRef = useRef(selectedTool); 
  const showHitboxesRef = useRef(showHitboxes);
  const frameCount = useRef<number>(0);
  const pendingReset = useRef<boolean>(false); // Flag to handle reset after resuming from pause during death
  
  // Tool Rotation Memory
  const lastToolRotation = useRef<number>(0);
  // Delete Tool Memory
  const lastDeletePos = useRef<{x: number, y: number} | null>(null);

  // Sync props to refs
  useEffect(() => { modeRef.current = mode; }, [mode]);
  
  useEffect(() => { 
      selectedToolRef.current = selectedTool; 
      // Reset tool rotation when tool changes
      lastToolRotation.current = 0;
  }, [selectedTool]);
  
  useEffect(() => { showHitboxesRef.current = showHitboxes; }, [showHitboxes]);

  // Fix Sticky Jump Keys on Mode Change
  useEffect(() => {
      keys.current['Space'] = false;
      keys.current['ArrowUp'] = false;
      mouse.current.isDown = false;
      prevInputState.current = false;
      hasInputUsed.current = false;
  }, [mode]);

  const notifySelection = () => {
      let hasBlock = false;
      let singleId: string | undefined;
      levelData.current.forEach(o => {
          if (selectedObjects.current.has(o.id)) {
             if (o.type === ObjectType.BLOCK) hasBlock = true;
             singleId = o.id;
          }
      });
      onSelectionChange(selectedObjects.current.size, hasBlock, selectedObjects.current.size === 1 ? singleId : undefined);
  };

  const notifyHistory = () => {
      onHistoryChange(historyIndex.current > 0, historyIndex.current < history.current.length - 1);
  };

  const getCurrentState = (): string => {
      return JSON.stringify({
          settings: levelSettings.current,
          objects: levelData.current
      });
  };

  const addToHistory = () => {
    if (historyIndex.current < history.current.length - 1) {
      history.current = history.current.slice(0, historyIndex.current + 1);
    }
    history.current.push(getCurrentState());
    historyIndex.current = history.current.length - 1;
    if (history.current.length > 50) {
      history.current.shift();
      historyIndex.current--;
    }
    notifyHistory();
  };

  const restoreState = (stateJson: string) => {
      try {
          const state = JSON.parse(stateJson);
          if (Array.isArray(state)) {
              levelData.current = state;
              levelSettings.current = { ...DEFAULT_LEVEL_SETTINGS };
          } else if (state.objects && state.settings) {
              levelData.current = state.objects;
              levelSettings.current = state.settings;
          }
          selectedObjects.current.clear();
          isPastedSelection.current = false;
          notifySelection();
      } catch (e) {
          console.error("Failed to restore history state", e);
      }
  };

  const undo = () => {
    if (historyIndex.current > 0) { 
      historyIndex.current--;
      restoreState(history.current[historyIndex.current]);
      notifyHistory();
    }
  };

  const redo = () => {
    if (historyIndex.current < history.current.length - 1) {
      historyIndex.current++;
      restoreState(history.current[historyIndex.current]);
      notifyHistory();
    }
  };

  const copySelection = () => {
      if (selectedObjects.current.size === 0) return;
      const objs = levelData.current.filter(o => selectedObjects.current.has(o.id));
      clipboard.current = JSON.parse(JSON.stringify(objs));
  };

  const pasteSelection = () => {
      if (clipboard.current.length === 0) return;
      
      const newIds = new Set<string>();
      const newObjs = clipboard.current.map(obj => {
          const newId = Math.random().toString(36).substr(2, 9);
          newIds.add(newId);
          return {
              ...obj,
              id: newId,
              x: obj.x,
              y: obj.y
          };
      });

      levelData.current.push(...newObjs);
      selectedObjects.current = newIds;
      isPastedSelection.current = true;
      notifySelection();
      addToHistory();
  };

  const moveSelectionInternal = (dx: number, dy: number) => {
      const newLevelData = [...levelData.current];
      const idMap = new Map(newLevelData.map(o => [o.id, o]));
      
      // Calculate adjusted dx to prevent Start Pos from going behind x=0
      let adjustedDx = dx;
      selectedObjects.current.forEach(id => {
          const obj = idMap.get(id);
          if (obj && obj.type === ObjectType.START_POS) {
              if (obj.x + adjustedDx < 0) {
                  adjustedDx = -obj.x; // Clamp to 0
              }
          }
      });

      let moved = false;
      selectedObjects.current.forEach(id => {
        const obj = idMap.get(id);
        if (obj) {
          obj.x = Math.round((obj.x + adjustedDx) * 100) / 100;
          obj.y = Math.round((obj.y + dy) * 100) / 100;
          moved = true;
        }
      });
      
      if (moved) {
          levelData.current = Array.from(idMap.values());
          addToHistory();
      }
  };

  const deleteSelection = () => {
      levelData.current = levelData.current.filter(o => !selectedObjects.current.has(o.id));
      selectedObjects.current.clear();
      notifySelection();
      addToHistory();
  };

  const deselectAll = () => {
      selectedObjects.current.clear();
      lastToolRotation.current = 0; // Reset saved rotation
      notifySelection();
  };

  // Color Interpolation Helper
  const interpolateColor = (color1: string, color2: string, factor: number) => {
      const hex = (color: string) => {
          if (color.startsWith('#')) return color;
          // Minimal handling for non-hex, assuming inputs are hex for now
          return '#000000';
      };
      
      const c1 = hex(color1);
      const c2 = hex(color2);
      
      const r1 = parseInt(c1.substring(1, 3), 16);
      const g1 = parseInt(c1.substring(3, 5), 16);
      const b1 = parseInt(c1.substring(5, 7), 16);
      
      const r2 = parseInt(c2.substring(1, 3), 16);
      const g2 = parseInt(c2.substring(3, 5), 16);
      const b2 = parseInt(c2.substring(5, 7), 16);
      
      const r = Math.round(r1 + (r2 - r1) * factor);
      const g = Math.round(g1 + (g2 - g1) * factor);
      const b = Math.round(b1 + (b2 - b1) * factor);
      
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  const resetPlayerInternal = (forVerify: boolean) => {
    selectedObjects.current.clear();
    notifySelection();

    // Default Spawn
    let startX = 0;
    let startY = 11 * TILE_SIZE;
    let startMode = levelSettings.current.startMode;
    let startGravityReversed = levelSettings.current.startReverseGravity || false;

    // Check for enabled Start Pos (Only in Playtest, NOT Verify)
    if (!forVerify) {
        // Find valid start pos
        const startPositions = levelData.current
            .map((obj, index) => ({ obj, index }))
            .filter(item => item.obj.type === ObjectType.START_POS && item.obj.startPosData && item.obj.startPosData.enabled);
        
        if (startPositions.length > 0) {
            // Sort: 
            // 1. Left-most X (Ascending). User wants "farther to the left".
            // 2. Most recent (Descending Index) if "same Y pos" (interpreted as tie-breaker or same location).
            startPositions.sort((a, b) => {
                if (Math.abs(a.obj.x - b.obj.x) > 0.01) return a.obj.x - b.obj.x;
                return b.index - a.index;
            });
            
            const best = startPositions[0].obj;
            if (best.startPosData) {
                startX = best.x * TILE_SIZE;
                startY = best.y * TILE_SIZE;
                startMode = best.startPosData.mode;
                startGravityReversed = best.startPosData.reverseGravity;
            }
        }
    }

    player.current = {
      x: startX, 
      y: startY, 
      w: 36, h: 36,
      vx: PLAYER_SPEED, vy: 0, rotation: 0,
      onGround: true, dead: false, finished: false,
      vehicle: startMode,
      gravityReversed: startGravityReversed
    };
    
    // Always clear markers/used objects on reset
    deathMarkers.current = [];
    usedObjectIds.current.clear();
    
    if (forVerify) {
      camera.current.x = 0;
      trail.current = [];
    } else {
      // In Editor Playtest, snap camera to start pos
      camera.current.x = startX - 200; // Offset slightly
      trail.current = [];
    }
    
    particles.current = [];
    isSuckedIntoWall.current = false;
    activeFloorY.current = FLOOR_Y;
    targetFloorY.current = FLOOR_Y;
    
    // Reset Colors
    displaySettings.current = { ...levelSettings.current };
    activeEffects.current = [];
    triggeredIds.current.clear();
    frameCount.current = 0;
    
    if (startMode === VehicleMode.SHIP) {
        if (!forVerify && startY < FLOOR_Y - 500) {
             activeCeilingY.current = FLOOR_Y - (10 * TILE_SIZE);
             targetCeilingY.current = FLOOR_Y - (10 * TILE_SIZE);
        } else {
             activeCeilingY.current = FLOOR_Y - (10 * TILE_SIZE);
             targetCeilingY.current = FLOOR_Y - (10 * TILE_SIZE);
        }
    } else {
        activeCeilingY.current = -99999;
        targetCeilingY.current = -99999;
    }
    
    keys.current = {};
    mouse.current.isDown = false;
    prevInputState.current = false;
    hasInputUsed.current = false;
    
    let maxX = 0;
    levelData.current.forEach(b => maxX = Math.max(maxX, b.x * TILE_SIZE));
    const calculatedEnd = Math.max(maxX + 800, window.innerWidth * 1.5);
    finishWallX.current = calculatedEnd;
  };

  const updateParticles = () => {
    for (let i = particles.current.length - 1; i >= 0; i--) {
        const p = particles.current[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.02;
        if (p.life <= 0) particles.current.splice(i, 1);
    }
  };

  const createExplosion = (x: number, y: number, count: number, color: string) => {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 5 + 2;
        particles.current.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1.0,
            color,
            size: Math.random() * 3 + 2,
            type: 'circle'
        });
    }
  };

  const getLocalHitbox = (type: ObjectType, subtype: number) => {
    if (type === ObjectType.BLOCK) {
        if (subtype === 3) return { x: 0, y: 0, w: 40, h: 20 }; // Top Half Slab (Fixed to match visual)
        return { x: 0, y: 0, w: 40, h: 40 };
    }
    if (type === ObjectType.SPIKE) {
        // Updated Spike Hitboxes to be centered
        if (subtype === 2) return { x: 16, y: 28, w: 8, h: 12 }; // Small "stud" spike (Centered)
        if (subtype === 3) return { x: 12, y: 24, w: 16, h: 16 }; // Medium spike (Centered)
        return { x: 13, y: 16, w: 14, h: 24 }; // Big spike (Centered)
    }
    if (type === ObjectType.PAD) return { x: 5, y: 30, w: 30, h: 10 }; // Centered
    if (type === ObjectType.ORB) return { x: 5, y: 5, w: 30, h: 30 }; // Centered
    if (type === ObjectType.PORTAL) {
        return { x: 5, y: -40, w: 30, h: 120 };
    }
    if (type === ObjectType.DECO) return { x: 0, y: 0, w: 40, h: 40 }; // Changed from 0,0,0,0 so it can be deleted
    if (type === ObjectType.TRIGGER) return { x: 0, y: 0, w: 30, h: 30 };
    if (type === ObjectType.START_POS) return { x: 0, y: 0, w: 40, h: 40 };
    return { x: 0, y: 0, w: 40, h: 40 };
  };

  const checkCollision = (p: Player, obj: LevelObject) => {
      const hb = getLocalHitbox(obj.type, obj.subtype);
      const objX = obj.x * TILE_SIZE;
      const objY = obj.y * TILE_SIZE;

      if (!obj.rotation || obj.rotation === 0) {
          const hbx = objX + hb.x;
          const hby = objY + hb.y;
          return (
             p.x < hbx + hb.w &&
             p.x + p.w > hbx &&
             p.y < hby + hb.h &&
             p.y + p.h > hby
          );
      } else {
           const angle = obj.rotation * (Math.PI / 180);
           const rcx = TILE_SIZE / 2;
           const rcy = TILE_SIZE / 2;
           const hx = hb.x, hy = hb.y, hw = hb.w, hh = hb.h;
           
           const points = [
               { x: hx, y: hy },
               { x: hx + hw, y: hy },
               { x: hx + hw, y: hy + hh },
               { x: hx, y: hy + hh }
           ];
           
           const worldPoints = points.map(pt => {
               const lx = pt.x - rcx;
               const ly = pt.y - rcy;
               const rx = lx * Math.cos(angle) - ly * Math.sin(angle);
               const ry = lx * Math.sin(angle) + ly * Math.cos(angle);
               return { x: objX + rcx + rx, y: objY + rcy + ry };
           });
           
           return checkPolygonInteract(worldPoints, { x: p.x, y: p.y, w: p.w, h: p.h });
      }
  };

  const die = () => {
      const p = player.current;
      if (p.dead) return;

      p.dead = true;
      createExplosion(p.x + p.w/2, p.y + p.h/2, 20, '#ffffff');
      
      // In Verify mode, FREEZE colors where they are
      if (modeRef.current === GameMode.VERIFY) {
          activeEffects.current = []; // Clear active effects to stop interpolation
          // displaySettings.current already holds the interpolated values from the last update frame
          // so by clearing effects, we effectively freeze it here.
      }

      // In Editor Playtest, we show the death marker
      // In Verify, we don't save markers
      if (modeRef.current === GameMode.PLAYTEST) {
          deathMarkers.current.push({ x: p.x + p.w/2, y: p.y + p.h/2 });
      }

      const currentMode = modeRef.current;
      const delay = (currentMode === GameMode.PLAYTEST) ? 0 : 800; // Instant for playtest, delayed for verify

      setTimeout(() => {
          if (modeRef.current === GameMode.VERIFY) {
              resetPlayerInternal(true);
          } else if (modeRef.current === GameMode.PLAYTEST) {
              onModeChange(GameMode.EDITOR);
          } else if (modeRef.current === GameMode.VERIFY_PAUSED) {
              // If paused while death sequence is running, ensure we reset on resume
              pendingReset.current = true;
          }
      }, delay);
  };

  useImperativeHandle(ref, () => ({
    setLevel: (data: any, keepHistory: boolean = false) => {
      if (Array.isArray(data)) {
          levelData.current = data;
          levelSettings.current = { ...DEFAULT_LEVEL_SETTINGS };
      } else if (data && data.objects && Array.isArray(data.objects)) {
          levelData.current = data.objects;
          levelSettings.current = { ...DEFAULT_LEVEL_SETTINGS, ...data.settings };
      } else {
          levelData.current = [];
          levelSettings.current = { ...DEFAULT_LEVEL_SETTINGS };
      }
      displaySettings.current = { ...levelSettings.current };

      selectedObjects.current.clear();
      isPastedSelection.current = false;
      
      if (keepHistory) {
          addToHistory();
      } else {
          history.current = [getCurrentState()];
          historyIndex.current = 0;
          notifyHistory();
      }
      notifySelection();
    },
    getLevel: () => ({
        settings: levelSettings.current,
        objects: levelData.current
    }),
    updateSettings: (newSettings: Partial<LevelSettings>) => {
        levelSettings.current = { ...levelSettings.current, ...newSettings };
        displaySettings.current = { ...displaySettings.current, ...newSettings };
        addToHistory();
    },
    updateSelectedTrigger: (data: any) => {
        const id = Array.from(selectedObjects.current)[0];
        const objIndex = levelData.current.findIndex(o => o.id === id);
        if (objIndex !== -1) {
            levelData.current[objIndex] = {
                ...levelData.current[objIndex],
                triggerData: {
                    ...levelData.current[objIndex].triggerData,
                    ...data
                }
            };
            addToHistory();
        }
    },
    updateSelectedStartPos: (data: any) => {
        const id = Array.from(selectedObjects.current)[0];
        const objIndex = levelData.current.findIndex(o => o.id === id);
        if (objIndex !== -1) {
            levelData.current[objIndex] = {
                ...levelData.current[objIndex],
                startPosData: {
                    ...levelData.current[objIndex].startPosData,
                    ...data
                }
            };
            addToHistory();
        }
    },
    getSelectedObject: () => {
        const id = Array.from(selectedObjects.current)[0];
        return levelData.current.find(o => o.id === id);
    },
    moveSelection: (dx, dy) => moveSelectionInternal(dx, dy),
    rotateSelection: (angle: number, relative: boolean) => {
        const ids = selectedObjects.current;
        if (ids.size === 0) return;

        // If selection size is 1, update lastToolRotation if applicable
        if (ids.size === 1) {
            const id = Array.from(ids)[0];
            const obj = levelData.current.find(o => o.id === id);
            if (obj) {
                let newRot = (obj.rotation || 0);
                if (relative) newRot += angle;
                else newRot = angle;
                newRot = newRot % 360;
                if (newRot < 0) newRot += 360;
                if (obj.type === ObjectType.BLOCK) newRot = Math.round(newRot / 90) * 90;
                
                // Update memory
                lastToolRotation.current = newRot;
            }
        }

        if (ids.size === 1) {
            levelData.current = levelData.current.map(obj => {
                if (ids.has(obj.id)) {
                    let newRot = (obj.rotation || 0);
                    if (relative) newRot += angle;
                    else newRot = angle;
                    newRot = newRot % 360;
                    if (newRot < 0) newRot += 360;
                    if (obj.type === ObjectType.BLOCK) newRot = Math.round(newRot / 90) * 90;
                    return { ...obj, rotation: newRot };
                }
                return obj;
            });
            addToHistory();
            return;
        }

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        const selectedObjs: LevelObject[] = [];
        
        levelData.current.forEach(obj => {
            if (ids.has(obj.id)) {
                const cx = obj.x + 0.5;
                const cy = obj.y + 0.5;
                if (cx < minX) minX = cx;
                if (cx > maxX) maxX = cx;
                if (cy < minY) minY = cy;
                if (cy > maxY) maxY = cy;
                selectedObjs.push(obj);
            }
        });
        
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const rad = (angle * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        levelData.current = levelData.current.map(obj => {
            if (ids.has(obj.id)) {
                const dx = (obj.x + 0.5) - centerX;
                const dy = (obj.y + 0.5) - centerY;
                const rDx = dx * cos - dy * sin;
                const rDy = dx * sin + dy * cos;
                const newX = (centerX + rDx) - 0.5;
                const newY = (centerY + rDy) - 0.5;
                let newRot = (obj.rotation || 0) + angle;
                newRot = newRot % 360;
                if (newRot < 0) newRot += 360;

                return {
                    ...obj,
                    x: Math.round(newX * 100) / 100,
                    y: Math.round(newY * 100) / 100,
                    rotation: newRot
                };
            }
            return obj;
        });
        addToHistory();
    },
    deleteSelection: () => {
      levelData.current = levelData.current.filter(o => !selectedObjects.current.has(o.id));
      selectedObjects.current.clear();
      notifySelection();
      addToHistory();
    },
    deselectAll: () => {
      selectedObjects.current.clear();
      lastToolRotation.current = 0; // Reset saved rotation
      notifySelection();
    },
    clearLevel: () => {
        levelData.current = [];
        selectedObjects.current.clear();
        notifySelection();
        addToHistory();
    },
    duplicateSelection: () => {
        copySelection();
        pasteSelection();
    },
    resetPlayer: (forVerify: boolean) => resetPlayerInternal(forVerify),
    undo,
    redo
  }));

  useEffect(() => {
    if (history.current.length === 0) {
        history.current.push(getCurrentState());
        historyIndex.current = 0;
        notifyHistory();
    }
  }, []);

  const handleEditorClick = (e: MouseEvent, isDrag: boolean) => {
    if (isPastedSelection.current) {
        isPastedSelection.current = false;
    }

    const camX = camera.current.x;
    const camY = camera.current.y;
    const zoom = camera.current.zoom;
    
    // Zoom-adjusted mouse coordinates
    const worldX = (e.clientX / zoom) + camX;
    const worldY = (e.clientY / zoom) + camY;
    
    // Use Math.floor but ensure we can place at negative coords correctly
    // Math.floor handles negatives correctly (-0.5 -> -1), so this is fine.
    const gridX = Math.floor(worldX / TILE_SIZE);
    const gridY = Math.floor(worldY / TILE_SIZE);

    if (selectedToolRef.current.type === ObjectType.TOOL) {
        if (boxSelectStart.current) {
            const startX = boxSelectStart.current.x;
            const startY = boxSelectStart.current.y;
            const endX = worldX;
            const endY = worldY;
            const minX = Math.min(startX, endX);
            const maxX = Math.max(startX, endX);
            const minY = Math.min(startY, endY);
            const maxY = Math.max(startY, endY);
            
            if (Math.abs(endX - startX) < 10 && Math.abs(endY - startY) < 10) {
                 const clickedObj = levelData.current.find(o => 
                     worldX >= o.x * TILE_SIZE && worldX < (o.x + 1) * TILE_SIZE &&
                     worldY >= o.y * TILE_SIZE && worldY < (o.y + 1) * TILE_SIZE
                 );
                 if (!e.shiftKey) selectedObjects.current.clear();
                 if (clickedObj) {
                     if (selectedObjects.current.has(clickedObj.id)) {
                         selectedObjects.current.delete(clickedObj.id);
                     } else {
                         selectedObjects.current.add(clickedObj.id);
                     }
                 }
            } else {
                 if (!e.shiftKey) selectedObjects.current.clear();
                 levelData.current.forEach(o => {
                     const ox = o.x * TILE_SIZE + TILE_SIZE/2;
                     const oy = o.y * TILE_SIZE + TILE_SIZE/2;
                     if (ox >= minX && ox <= maxX && oy >= minY && oy <= maxY) {
                         selectedObjects.current.add(o.id);
                     }
                 });
            }
            notifySelection();
            boxSelectStart.current = null;
        }
    } else if (selectedToolRef.current.type === ObjectType.DELETE) {
        // Prevent re-deletion on same tile during a single drag stroke
        if (isDrag && lastDeletePos.current && lastDeletePos.current.x === gridX && lastDeletePos.current.y === gridY) {
            return;
        }

        const clickRect = {
            x: gridX * TILE_SIZE,
            y: gridY * TILE_SIZE,
            w: TILE_SIZE,
            h: TILE_SIZE
        };

        let deleted = false;
        // Iterate backwards to delete top-most first
        for (let i = levelData.current.length - 1; i >= 0; i--) {
            const obj = levelData.current[i];
            const hb = getLocalHitbox(obj.type, obj.subtype);
            
            let isOverlapping = false;
            const objX = obj.x * TILE_SIZE;
            const objY = obj.y * TILE_SIZE;

            if (!obj.rotation || obj.rotation === 0) {
                 const hbx = objX + hb.x;
                 const hby = objY + hb.y;
                 isOverlapping = (
                     clickRect.x < hbx + hb.w &&
                     clickRect.x + clickRect.w > hbx &&
                     clickRect.y < hby + hb.h &&
                     clickRect.y + clickRect.h > hby
                 );
            } else {
                 const angle = obj.rotation * (Math.PI / 180);
                 const rcx = TILE_SIZE / 2;
                 const rcy = TILE_SIZE / 2;
                 const hx = hb.x, hy = hb.y, hw = hb.w, hh = hb.h;
                 
                 const points = [
                     { x: hx, y: hy },
                     { x: hx + hw, y: hy },
                     { x: hx + hw, y: hy + hh },
                     { x: hx, y: hy + hh }
                 ];
                 
                 const worldPoints = points.map(pt => {
                     const lx = pt.x - rcx;
                     const ly = pt.y - rcy;
                     const rx = lx * Math.cos(angle) - ly * Math.sin(angle);
                     const ry = lx * Math.sin(angle) + ly * Math.cos(angle);
                     return { x: objX + rcx + rx, y: objY + rcy + ry };
                 });
                 
                 isOverlapping = checkPolygonInteract(worldPoints, clickRect);
            }

            if (isOverlapping) {
                levelData.current.splice(i, 1);
                deleted = true;
                break; // One at a time
            }
        }
        
        if (deleted) {
            addToHistory();
            // Mark this grid position as processed for this drag
            lastDeletePos.current = { x: gridX, y: gridY };
        }
    } else {
        // DRAG PLACEMENT ENABLED
        const existing = levelData.current.find(o => o.x === gridX && o.y === gridY);
        
        // Prevent placement of Start Pos behind X=0
        if (selectedToolRef.current.type === ObjectType.START_POS && gridX < 0) {
            return;
        }

        if (!existing || selectedToolRef.current.type === ObjectType.START_POS) { 
             // Default Trigger Data
             let triggerData = undefined;
             let startPosData = undefined;
             
             if (selectedToolRef.current.type === ObjectType.TRIGGER) {
                 triggerData = { target: 'bgColorTop', color: '#ff0000', duration: 0.5, touchTrigger: false };
             } else if (selectedToolRef.current.type === ObjectType.START_POS) {
                 startPosData = { mode: VehicleMode.CUBE, reverseGravity: false, enabled: true };
             }

             const newId = Math.random().toString(36).substr(2, 9);
             levelData.current.push({
                 id: newId,
                 x: gridX, 
                 y: gridY,
                 type: selectedToolRef.current.type,
                 subtype: selectedToolRef.current.subtype,
                 rotation: lastToolRotation.current,
                 triggerData: triggerData as any,
                 startPosData: startPosData as any
             });
             
             // Auto-select the newly placed object
             selectedObjects.current.clear();
             selectedObjects.current.add(newId);
             notifySelection();
             
             addToHistory();
        }
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const onKeyDown = (e: KeyboardEvent) => { 
        keys.current[e.code] = true; 
        
        const isCtrl = e.ctrlKey || e.metaKey;
        const isShift = e.shiftKey;
        
        if (modeRef.current === GameMode.EDITOR || modeRef.current === GameMode.PAUSED) {
            // Shortcuts
            if (isCtrl && !e.repeat) {
                if (e.code === 'KeyZ') { e.preventDefault(); undo(); }
                else if (e.code === 'KeyY') { e.preventDefault(); redo(); }
                else if (e.code === 'KeyC') { e.preventDefault(); copySelection(); }
                else if (e.code === 'KeyV') { e.preventDefault(); pasteSelection(); }
            }

            // Object Movement
            if (selectedObjects.current.size > 0) {
                let dx = 0;
                let dy = 0;
                
                if (e.code === 'ArrowUp' || e.code === 'KeyW') dy = -1;
                else if (e.code === 'ArrowDown' || e.code === 'KeyS') dy = 1;
                else if (e.code === 'ArrowLeft' || e.code === 'KeyA') dx = -1;
                else if (e.code === 'ArrowRight' || e.code === 'KeyD') dx = 1;
                
                if (dx !== 0 || dy !== 0) {
                    let amount = 1;
                    if (isShift && isCtrl) amount = 5;
                    else if (isShift) amount = 0.5;
                    else if (isCtrl) amount = 0.1;
                    
                    // Don't move camera if we are moving objects
                    e.preventDefault();
                    moveSelectionInternal(dx * amount, dy * amount);
                }
            }
        }
    };
    const onKeyUp = (e: KeyboardEvent) => { keys.current[e.code] = false; };
    
    const onMouseDown = (e: MouseEvent) => {
        mouse.current.isDown = true;
        mouse.current.x = e.clientX;
        mouse.current.y = e.clientY;
        mouse.current.dragStartX = e.clientX;
        mouse.current.dragStartY = e.clientY;
        
        // Reset last delete position on new click
        lastDeletePos.current = null;
        
        if (e.button === 2) {
            mouse.current.isRightDown = true;
        } else if (modeRef.current === GameMode.EDITOR || modeRef.current === GameMode.PAUSED) {
            if (selectedToolRef.current.type === ObjectType.TOOL) {
                const camX = camera.current.x;
                const camY = camera.current.y;
                const zoom = camera.current.zoom;
                boxSelectStart.current = { x: (e.clientX / zoom) + camX, y: (e.clientY / zoom) + camY };
            } else {
                handleEditorClick(e, false);
            }
        }
    };
    
    const onMouseUp = (e: MouseEvent) => {
        const wasDown = mouse.current.isDown;
        mouse.current.isDown = false;
        if (e.button === 2) mouse.current.isRightDown = false;
        // Allow editing interactions in PAUSED mode too
        if ((modeRef.current === GameMode.EDITOR || modeRef.current === GameMode.PAUSED) && e.button === 0 && wasDown) {
             if (selectedToolRef.current.type === ObjectType.TOOL) {
                 handleEditorClick(e, true);
             }
             // Deleted the explicit DELETE tool check here as it is now handled via drag in onMouseMove
        }
    };
    
    const onMouseMove = (e: MouseEvent) => {
        const dx = e.clientX - mouse.current.x;
        const dy = e.clientY - mouse.current.y;
        mouse.current.x = e.clientX;
        mouse.current.y = e.clientY;
        
        const mode = modeRef.current;
        if (mode === GameMode.EDITOR || mode === GameMode.PAUSED || mode === GameMode.VERIFY_PAUSED) {
            if (mouse.current.isRightDown) {
                // Adjust dragging for zoom
                const zoom = camera.current.zoom;
                camera.current.x -= dx / zoom;
                camera.current.y -= dy / zoom;
            } else if (mouse.current.isDown) {
                 if (selectedToolRef.current.type !== ObjectType.TOOL && (mode === GameMode.EDITOR || mode === GameMode.PAUSED)) {
                     handleEditorClick(e, true);
                 }
            }
        }
    };
    
    const onWheel = (e: WheelEvent) => {
        if (modeRef.current === GameMode.EDITOR || modeRef.current === GameMode.PAUSED) {
            e.preventDefault();
            const zoomSpeed = 0.001;
            let newZoom = camera.current.zoom - e.deltaY * zoomSpeed;
            newZoom = Math.max(0.5, Math.min(newZoom, 2.5)); // Zoom Limits
            
            // Calculate center of screen in world coordinates before zoom
            const width = canvas.width;
            const height = canvas.height;
            const centerX = camera.current.x + (width / 2) / camera.current.zoom;
            const centerY = camera.current.y + (height / 2) / camera.current.zoom;
            
            camera.current.zoom = newZoom;
            
            // Adjust camera position so the center remains fixed
            camera.current.x = centerX - (width / 2) / newZoom;
            camera.current.y = centerY - (height / 2) / newZoom;
        }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();

    const update = () => {
      const currentMode = modeRef.current;
      const width = canvas.width;
      const height = canvas.height;
      const zoom = camera.current.zoom;
      
      // Update Zoom for Game Modes
      if (currentMode === GameMode.PLAYTEST || currentMode === GameMode.VERIFY) {
          // Force closer zoom for gameplay
          camera.current.zoom = 1.2;
      }

      // Handle resume from death pause
      if (currentMode === GameMode.VERIFY && pendingReset.current) {
          pendingReset.current = false;
          resetPlayerInternal(true);
      }

      // Animation for Floor/Ceiling
      activeFloorY.current = activeFloorY.current + (targetFloorY.current - activeFloorY.current) * 0.1;
      
      // Ceiling Logic
      let destCeil = targetCeilingY.current;
      
      if (destCeil < -90000) {
          // Disable mode (Cube)
          // If active ceiling is "active" ( > -90000 ), animate it out
          if (activeCeilingY.current > -90000) {
              const offScreenY = camera.current.y - 1000; // Target above screen
              
              // Move towards offScreenY
              // If we are already above offScreenY (smaller Y), snap to -99999
              if (activeCeilingY.current < offScreenY + 50) {
                  activeCeilingY.current = -99999;
              } else {
                  activeCeilingY.current = activeCeilingY.current + (offScreenY - activeCeilingY.current) * 0.1;
              }
          }
          // If already < -90000, do nothing (stay disabled)
      } else {
          // Enable mode (Ship)
          if (activeCeilingY.current < -90000) {
              // Initialize from top
              activeCeilingY.current = camera.current.y - 1000; 
          }
          // Animate to target
          activeCeilingY.current = activeCeilingY.current + (destCeil - activeCeilingY.current) * 0.1;
      }
      
      // Color Interpolation Logic
      if (currentMode !== GameMode.PAUSED && currentMode !== GameMode.VERIFY_PAUSED) {
          if (currentMode === GameMode.EDITOR) {
              // EDITOR COLOR PREVIEW
              // Calculate what the color *should* be at the camera center based on triggers
              let simSettings = { ...levelSettings.current };
              const centerX = camera.current.x + (width / zoom) / 2;
              
              // Filter relevant triggers sorted by X
              const relevantTriggers = levelData.current
                  .filter(o => o.type === ObjectType.TRIGGER && o.triggerData && (o.x * TILE_SIZE) < centerX)
                  .sort((a, b) => a.x - b.x);
                  
              relevantTriggers.forEach(t => {
                  if (!t.triggerData) return;
                  if (t.triggerData.touchTrigger) return; // Touch triggers don't activate by position in editor preview

                  const triggerX = t.x * TILE_SIZE + TILE_SIZE/2;
                  const distance = centerX - triggerX;
                  const fadeLength = t.triggerData.duration * 60 * PLAYER_SPEED;
                  
                  let progress = 1;
                  if (fadeLength > 0) {
                      progress = Math.min(1, Math.max(0, distance / fadeLength));
                  }
                  
                  const target = t.triggerData.target;
                  simSettings[target] = interpolateColor(simSettings[target], t.triggerData.color, progress);
              });
              
              displaySettings.current = simSettings;
          } else if (!player.current.dead) {
              // GAMEPLAY COLOR LOGIC - ONLY UPDATE IF ALIVE
              // If dead in VERIFY, colors are frozen in `die()` by clearing effects
              
              frameCount.current++;
              activeEffects.current = activeEffects.current.filter(eff => frameCount.current < eff.startTime + eff.duration);
              
              activeEffects.current.forEach(eff => {
                  const progress = (frameCount.current - eff.startTime) / eff.duration;
                  const clampedProgress = Math.min(1, Math.max(0, progress));
                  const newColor = interpolateColor(eff.startColor, eff.endColor, clampedProgress);
                  
                  displaySettings.current = {
                      ...displaySettings.current,
                      [eff.target]: newColor
                  };
              });
          }
      }

      if (currentMode === GameMode.PLAYTEST || currentMode === GameMode.VERIFY) {
        updatePhysics(width, height);
      }
      
      updateParticles();
      spawnIdleParticles(width, height);

      if (currentMode === GameMode.EDITOR || currentMode === GameMode.PAUSED || currentMode === GameMode.VERIFY_PAUSED) {
        const camSpeed = 15 / camera.current.zoom; // Adjust camera speed by zoom
        if (keys.current['KeyW']) camera.current.y -= camSpeed;
        if (keys.current['KeyS']) camera.current.y += camSpeed;
        if (keys.current['KeyA']) camera.current.x -= camSpeed;
        if (keys.current['KeyD']) camera.current.x += camSpeed;
      } else {
        const p = player.current;
        const cam = camera.current;
        
        // Calculate target positions considering zoom
        const targetX = p.x - (width / zoom) / 3;
        
        let targetY;
        const visibleHeight = height / zoom;
        
        if (p.vehicle === VehicleMode.SHIP && targetCeilingY.current > -90000) {
             // USE TARGET CEILING FOR CAMERA STABILITY
             const floor = targetFloorY.current;
             const ceiling = targetCeilingY.current;
             const midY = (floor + ceiling) / 2;
             targetY = midY - (visibleHeight * 0.5);
        } else {
             targetY = p.y - (visibleHeight * 0.55); // Centered
             const maxCamY = FLOOR_Y - visibleHeight + 150; // Increased to show more ground
             if (targetY > maxCamY) targetY = maxCamY;
        }

        let nextCamX = targetX;
        
        if (currentMode === GameMode.VERIFY) {
            const maxCamX = finishWallX.current - (width / zoom) + 300; 
            if (nextCamX > maxCamX) {
                nextCamX = maxCamX;
            }
        }

        cam.x += (nextCamX - cam.x) * 0.1;
        cam.y += (targetY - cam.y) * 0.1;
      }

      draw(ctx, width, height, currentMode);
      requestRef.current = requestAnimationFrame(update);
    };

    requestRef.current = requestAnimationFrame(update);
    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('wheel', onWheel);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  const spawnIdleParticles = (width: number, height: number) => {
      const zoom = camera.current.zoom;
      const viewX = camera.current.x;
      const visibleWidth = width / zoom;
      
      if (modeRef.current === GameMode.VERIFY && finishWallX.current < 900000 && finishWallX.current > viewX - 100 && finishWallX.current < viewX + visibleWidth + 100) {
          if (Math.random() < 0.2) {
             particles.current.push({
                 x: finishWallX.current + Math.random() * 40,
                 y: FLOOR_Y - Math.random() * 800, 
                 vx: (Math.random() - 0.5) * 6,
                 vy: (Math.random() - 0.5) * 6,
                 life: 1.0 + Math.random(),
                 color: 'rgba(255, 255, 255, 0.4)',
                 type: 'circle',
                 size: Math.random() * 3 + 1
             });
          }
      }

      levelData.current.forEach(obj => {
          if (obj.type === ObjectType.PAD || obj.type === ObjectType.ORB || obj.type === ObjectType.PORTAL) {
              const bx = obj.x * TILE_SIZE;
              if (bx > viewX - 100 && bx < viewX + visibleWidth + 100) {
                  if (Math.random() < 0.03) { 
                      const cx = bx + TILE_SIZE/2;
                      const cy = obj.y * TILE_SIZE + TILE_SIZE/2; 
                      
                      if (obj.type === ObjectType.PORTAL) {
                          let color = COLORS.objPortalGreen;
                          if (obj.subtype === 2) color = COLORS.objPortalPink;
                          if (obj.subtype === 3) color = COLORS.objPortalYellow;
                          if (obj.subtype === 4) color = COLORS.objPortalBlue;
                          if (obj.subtype === 5) color = COLORS.objPortalGreen;

                           particles.current.push({
                             x: cx + (Math.random() - 0.5) * 20,
                             y: cy + (Math.random() - 0.5) * 40,
                             vx: 0,
                             vy: (Math.random() - 0.5) * 2,
                             life: 0.6,
                             color: color,
                             type: 'circle',
                             size: 2
                         });
                      } else if (obj.type === ObjectType.PAD) {
                         const rot = (obj.rotation || 0) * (Math.PI / 180);
                         const padY = obj.y * TILE_SIZE + TILE_SIZE; 
                         const ux = Math.sin(rot);
                         const uy = -Math.cos(rot);
                         const color = obj.subtype === 1 ? COLORS.objPadPink : (obj.subtype === 2 ? COLORS.objPadYellow : (obj.subtype === 4 ? COLORS.objPadCyan : COLORS.objPadRed));
                         particles.current.push({
                              x: (bx + TILE_SIZE/2) + (Math.random() - 0.5) * 20,
                              y: padY + (Math.random() - 0.5) * 10 - 5,
                              vx: ux * (Math.random() * 2 + 1),
                              vy: uy * (Math.random() * 2 + 1),
                              life: 0.8,
                              color: color,
                              type: 'circle'
                          });
                      } else {
                         const color = obj.subtype === 1 ? COLORS.objPadPink : (obj.subtype === 2 ? COLORS.objPadYellow : (obj.subtype === 4 ? COLORS.objPadCyan : COLORS.objPadRed));
                         const ang = Math.random() * Math.PI * 2;
                         const dist = 10;
                         particles.current.push({
                             x: cx + Math.cos(ang) * dist,
                             y: cy + Math.sin(ang) * dist,
                             vx: Math.cos(ang) * 0.5,
                             vy: Math.sin(ang) * 0.5,
                             life: 0.8,
                             color: color,
                             type: 'circle',
                             size: 2
                         });
                      }
                  }
              }
          }
      });
  };

  const jump = () => {
    const p = player.current;
    if (p.gravityReversed) {
        p.vy = -JUMP_FORCE; // Jump Down (positive Y)
    } else {
        p.vy = JUMP_FORCE; // Jump Up (negative Y)
    }
    p.onGround = false;
  };

  const updatePhysics = (width: number, height: number) => {
    const p = player.current;
    if (p.dead) return;

    if (p.finished && modeRef.current === GameMode.VERIFY) {
      if (isSuckedIntoWall.current) {
        p.x += (finishWallX.current + 50 - p.x) * 0.1;
        p.w *= 0.9;
        p.h *= 0.9;
        p.rotation += 0.5;
        if (p.w < 1) {
          isSuckedIntoWall.current = false;
          onModeChange(GameMode.COMPLETE);
        }
      }
      return;
    }

    if (modeRef.current === GameMode.VERIFY && p.x > finishWallX.current) {
      p.finished = true;
      isSuckedIntoWall.current = true;
      createExplosion(finishWallX.current, height / 2, 50, '#ffffff');
      return;
    }

    const isInputDown = keys.current['Space'] || keys.current['ArrowUp'] || mouse.current.isDown;
    const inputJustPressed = isInputDown && !prevInputState.current;
    prevInputState.current = isInputDown;
    
    if (inputJustPressed) hasInputUsed.current = false;
    if (!isInputDown) hasInputUsed.current = false;

    p.x += PLAYER_SPEED;

    if (p.vehicle === VehicleMode.CUBE) {
        // Gravity Application
        if (p.gravityReversed) {
            p.vy -= GRAVITY; // Fall Up (Negative Y)
            if (p.vy < -TERMINAL_VELOCITY) p.vy = -TERMINAL_VELOCITY;
        } else {
            p.vy += GRAVITY; // Fall Down (Positive Y)
            if (p.vy > TERMINAL_VELOCITY) p.vy = TERMINAL_VELOCITY;
        }
        
        p.y += p.vy;

        // Rotation Logic
        if (!p.onGround) p.rotation += (Math.PI / 2) * 0.15;
        else p.rotation = Math.round(p.rotation / (Math.PI / 2)) * (Math.PI / 2);

        // Floor / Ceiling Collision (Infinite)
        if (!p.gravityReversed) {
            // Standard Floor
            if (p.y + p.h >= activeFloorY.current) {
                p.y = activeFloorY.current - p.h;
                p.vy = 0;
                p.onGround = true;
                p.rotation = 0;
            } else {
                p.onGround = false;
            }
        } else {
             // Ceiling becomes floor (if activeCeiling exists, otherwise infinite fall up)
             // However, activeCeilingY is usually -99999 unless ship mode triggers it.
             // If we want a 'ceiling' floor for cube, we'd need that enabled.
             // For now, reverse gravity cube falls into sky if no blocks.
             if (activeCeilingY.current > -90000 && p.y <= activeCeilingY.current) {
                 p.y = activeCeilingY.current;
                 p.vy = 0;
                 p.onGround = true;
                 p.rotation = 0;
             } else {
                 p.onGround = false;
                 
                 // SPECIAL CASE: If reverse gravity cube hits standard floor, DIE
                 if (p.y + p.h > activeFloorY.current) {
                     die();
                     return;
                 }
             }
        }

    } else {
        // SHIP MODE
        if (p.gravityReversed) {
             p.vy -= SHIP_GRAVITY; // Gravity pulls UP
             if (isInputDown) {
                 p.vy -= SHIP_THRUST; // Thrust pushes DOWN (Positive Y)
             }
        } else {
             p.vy += SHIP_GRAVITY; // Gravity pulls DOWN
             if (isInputDown) {
                 p.vy += SHIP_THRUST; // Thrust pushes UP (Negative Y)
             }
        }
        
        if (p.vy > SHIP_TERMINAL_VELOCITY) p.vy = SHIP_TERMINAL_VELOCITY;
        if (p.vy < -SHIP_TERMINAL_VELOCITY) p.vy = -SHIP_TERMINAL_VELOCITY;
        
        p.y += p.vy;
        p.rotation = Math.atan2(p.vy, PLAYER_SPEED * 1.5);

        const ceil = activeCeilingY.current;
        const flr = activeFloorY.current;
        
        if (p.y < ceil) {
            p.y = ceil;
            if (p.vy < 0) p.vy = 0;
            if (p.gravityReversed) p.onGround = true;
        } else if (p.y + p.h > flr) {
            p.y = flr - p.h;
            if (p.vy > 0) p.vy = 0;
            if (!p.gravityReversed) p.onGround = true; 
        } else {
            p.onGround = false;
        }
    }

    if (modeRef.current !== GameMode.VERIFY && p.x % 5 < PLAYER_SPEED) {
      trail.current.push({ x: p.x + p.w / 2, y: p.y + p.h / 2 });
      if (trail.current.length > 5000) trail.current.shift();
    }

    const margin = TILE_SIZE * 2;
    const pRight = p.x + p.w;
    const pCx = p.x + p.w/2;
    
    for (const obj of levelData.current) {
      // Check for Trigger Activation
      if (obj.type === ObjectType.TRIGGER && obj.triggerData) {
          if (!triggeredIds.current.has(obj.id)) {
              let activated = false;
              
              if (obj.triggerData.touchTrigger) {
                  if (checkCollision(p, obj)) activated = true;
              } else {
                  const triggerCenterX = obj.x * TILE_SIZE + TILE_SIZE/2;
                  if (pCx >= triggerCenterX && (pCx - PLAYER_SPEED) < triggerCenterX) activated = true;
              }

              if (activated) {
                  triggeredIds.current.add(obj.id);
                  const durationFrames = (obj.triggerData.duration || 0) * 60; 
                  
                  if (durationFrames === 0) {
                      displaySettings.current = {
                          ...displaySettings.current,
                          [obj.triggerData.target]: obj.triggerData.color
                      };
                  } else {
                      activeEffects.current.push({
                          target: obj.triggerData.target,
                          startColor: displaySettings.current[obj.triggerData.target],
                          endColor: obj.triggerData.color,
                          startTime: frameCount.current,
                          duration: durationFrames
                      });
                  }
              }
          }
          continue;
      }

      if (obj.type === ObjectType.DECO || obj.type === ObjectType.START_POS) continue;
      const bx = obj.x * TILE_SIZE;
      if (bx > pRight + margin || bx + TILE_SIZE < p.x - margin) continue;
      
      const collision = checkCollision(p, obj);

      if (collision) {
          if (obj.type === ObjectType.SPIKE) {
              die();
              return;
          } else if (obj.type === ObjectType.BLOCK) {
              const prevY = p.y - p.vy;
              const blockTop = obj.y * TILE_SIZE;
              const blockBottom = (obj.y + 1) * TILE_SIZE;
              
              if (p.vehicle === VehicleMode.SHIP) {
                   if (obj.subtype === 3) {
                       // SHIP SLAB LOGIC
                       const rot = (obj.rotation || 0) % 360;
                       const isBottomSlab = Math.abs(rot - 180) < 10;
                       
                       let sTop, sBot;
                       if (isBottomSlab) {
                           sTop = obj.y * TILE_SIZE + 20; 
                           sBot = obj.y * TILE_SIZE + 40; 
                       } else {
                           sTop = obj.y * TILE_SIZE; 
                           sBot = obj.y * TILE_SIZE + 20; 
                       }
                       
                       if (prevY + p.h <= sTop + 15 && p.vy >= 0) {
                            p.y = sTop - p.h;
                            p.vy = 0;
                       } else if (prevY >= sBot - 15 && p.vy <= 0) {
                            p.y = sBot;
                            p.vy = 0;
                       } else {
                            die(); 
                            return;
                       }
                   } else {
                       if (prevY + p.h <= blockTop + 15 && p.vy >= 0) {
                            p.y = blockTop - p.h;
                            p.vy = 0;
                       } else if (prevY >= blockBottom - 15 && p.vy <= 0) {
                            p.y = blockBottom;
                            p.vy = 0;
                       } else {
                            die(); 
                            return;
                       }
                   }
              } else {
                  // CUBE LOGIC (GRAVITY AWARE)
                  if (obj.subtype === 3) { 
                       // Slab Logic
                       const rot = (obj.rotation || 0) % 360;
                       const isBottomSlab = Math.abs(rot - 180) < 10;
                       
                       let sTop, sBot;
                       if (isBottomSlab) {
                           sTop = obj.y * TILE_SIZE + 20; 
                           sBot = obj.y * TILE_SIZE + 40;
                       } else {
                           sTop = obj.y * TILE_SIZE; 
                           sBot = obj.y * TILE_SIZE + 20;
                       }

                       if (!p.gravityReversed) {
                           // Standard Gravity: Land on Top
                           const wasAbove = prevY + p.h <= sTop + Math.max(Math.abs(p.vy), 5);
                           if (wasAbove && p.vy >= 0) {
                               p.y = sTop - p.h;
                               p.vy = 0;
                               p.onGround = true;
                               p.rotation = 0;
                               continue;
                           } else { die(); return; }
                       } else {
                           // Reversed Gravity: Land on Bottom
                           const wasBelow = prevY >= sBot - Math.max(Math.abs(p.vy), 5);
                           if (wasBelow && p.vy <= 0) {
                               p.y = sBot;
                               p.vy = 0;
                               p.onGround = true;
                               p.rotation = 0;
                               continue;
                           } else { die(); return; }
                       }
                  } else {
                       if (!p.gravityReversed) {
                           // Standard Gravity
                           const wasAbove = prevY + p.h <= blockTop + Math.max(Math.abs(p.vy), 5);
                           if (wasAbove && p.vy >= 0) {
                               p.y = blockTop - p.h;
                               p.vy = 0;
                               p.onGround = true;
                               p.rotation = 0;
                               continue;
                           } else { die(); return; }
                       } else {
                           // Reversed Gravity: Land on Bottom of block
                           const wasBelow = prevY >= blockBottom - Math.max(Math.abs(p.vy), 5);
                           if (wasBelow && p.vy <= 0) {
                               p.y = blockBottom;
                               p.vy = 0;
                               p.onGround = true;
                               p.rotation = 0;
                               continue;
                           } else { die(); return; }
                       }
                  }
              }
          } else if (obj.type === ObjectType.PAD) {
              if (!usedObjectIds.current.has(obj.id)) {
                  usedObjectIds.current.add(obj.id);
                  
                  if (obj.subtype === 4) { // BLUE PAD
                      // Flip Gravity
                      p.gravityReversed = !p.gravityReversed;
                      p.onGround = false;
                      
                      // User requested "small smooth up... not as smooth as portals but still a lil"
                      // Standard forces are 16.5 (Yellow), 10 (Pink).
                      // 9.0 is soft.
                      const magnitude = 9.0;
                      
                      if (p.gravityReversed) p.vy = -magnitude; 
                      else p.vy = magnitude; 
                      
                      const center = { x: bx + TILE_SIZE/2, y: obj.y * TILE_SIZE + TILE_SIZE/2 };
                      particles.current.push({ x: center.x, y: center.y, vx: 0, vy: 0, life: 1.0, color: COLORS.objPadCyan, type: 'ring', size: 15 });
                  } else {
                      let force = PAD_FORCE_YELLOW;
                      if (obj.subtype === 1) force = PAD_FORCE_PINK;
                      if (obj.subtype === 3) force = PAD_FORCE_RED;
                      
                      // PAD PHYSICS (Independent of rotation)
                      // Pads always push "up" relative to gravity.
                      // Forces are negative (e.g., -16.5) which means Up in normal gravity (negative Y).
                      
                      if (p.gravityReversed) {
                          // Reverse gravity: Up is positive Y.
                          // Force is negative. So we flip sign to positive.
                          p.vy = -force; 
                      } else {
                          // Normal gravity: Up is negative Y.
                          // Force is negative. Use directly.
                          p.vy = force;
                      }
                      
                      p.onGround = false;
                      
                      const color = obj.subtype === 1 ? COLORS.objPadPink : (obj.subtype === 2 ? COLORS.objPadYellow : COLORS.objPadRed);
                      const center = { x: bx + TILE_SIZE/2, y: obj.y * TILE_SIZE + TILE_SIZE/2 };
                      particles.current.push({ x: center.x, y: center.y, vx: 0, vy: 0, life: 1.0, color: color, type: 'ring', size: 15 });
                  }
              }
          } else if (obj.type === ObjectType.ORB) {
              if (!usedObjectIds.current.has(obj.id)) {
                  const canActivate = p.vehicle === VehicleMode.SHIP 
                      ? inputJustPressed 
                      : (isInputDown && !hasInputUsed.current);

                  if (canActivate) {
                      usedObjectIds.current.add(obj.id);
                      hasInputUsed.current = true;
                      
                      if (obj.subtype === 4) { // BLUE ORB
                          p.gravityReversed = !p.gravityReversed;
                          p.onGround = false;
                          
                          if (p.vehicle === VehicleMode.SHIP) {
                              // "just like flips smoothly not like instantly up"
                              // Use a very small impulse to guide direction
                              const magnitude = 4.0;
                              if (p.gravityReversed) p.vy = -magnitude;
                              else p.vy = magnitude;
                          } else {
                              // Cube: "small smooth up"
                              const magnitude = 8.0; 
                              if (p.gravityReversed) p.vy = -magnitude;
                              else p.vy = magnitude;
                          }
                          
                          particles.current.push({ x: bx + TILE_SIZE/2, y: obj.y * TILE_SIZE + TILE_SIZE/2, vx: 0, vy: 0, life: 0.5, color: COLORS.objPadCyan, type: 'ring', size: 20 });
                      } else {
                          let force = ORB_FORCE_YELLOW;
                          if (obj.subtype === 1) force = ORB_FORCE_PINK;
                          if (obj.subtype === 3) force = ORB_FORCE_RED;
                          
                          // Orbs always push 'jump' height relative to gravity
                          if (p.gravityReversed) {
                              p.vy = -force; // Push down
                          } else {
                              p.vy = force; // Push up
                          }
                          
                          p.onGround = false;
                          const color = obj.subtype === 1 ? COLORS.objPadPink : (obj.subtype === 2 ? COLORS.objPadYellow : COLORS.objPadRed);
                          particles.current.push({ x: bx + TILE_SIZE/2, y: obj.y * TILE_SIZE + TILE_SIZE/2, vx: 0, vy: 0, life: 0.5, color: color, type: 'ring', size: 20 });
                      }
                  }
              }
          } else if (obj.type === ObjectType.PORTAL) {
              if (!usedObjectIds.current.has(obj.id)) {
                  usedObjectIds.current.add(obj.id);
                  
                  // MODE PORTALS
                  if (obj.subtype === 1 && p.vehicle !== VehicleMode.CUBE) {
                      p.vehicle = VehicleMode.CUBE;
                      targetFloorY.current = FLOOR_Y; 
                      targetCeilingY.current = -99999;
                      p.rotation = Math.round(p.rotation / (Math.PI/2)) * (Math.PI/2);
                  } else if (obj.subtype === 2) { 
                      if (obj.y <= 6) {
                          targetFloorY.current = (obj.y + 5) * TILE_SIZE;
                          targetCeilingY.current = (obj.y - 5) * TILE_SIZE;
                      } else {
                          targetFloorY.current = FLOOR_Y;
                          targetCeilingY.current = FLOOR_Y - (10 * TILE_SIZE);
                      }
                      if (p.vehicle !== VehicleMode.SHIP) {
                          p.vehicle = VehicleMode.SHIP;
                          p.vy = 0; 
                      }
                  }
                  
                  // GRAVITY PORTALS
                  if (obj.subtype === 3) { // Yellow (Reverse)
                      if (!p.gravityReversed) p.gravityReversed = true;
                  } else if (obj.subtype === 4) { // Blue (Normal)
                      if (p.gravityReversed) p.gravityReversed = false;
                  } else if (obj.subtype === 5) { // Green (Toggle)
                      p.gravityReversed = !p.gravityReversed;
                  }

                  particles.current.push({ x: p.x, y: p.y, vx: 0, vy: 0, life: 1, color: '#fff', type: 'ring', size: 50 });
              }
          }
      }
    }

    if (p.vehicle === VehicleMode.CUBE) {
        if (p.onGround && isInputDown) {
            jump();
            hasInputUsed.current = true;
        }
    }

    // Death boundary check depends on gravity
    if (!p.gravityReversed) {
        if (p.y > FLOOR_Y + 500) die();
    } else {
        if (p.y < -2000) die(); // Approximate ceiling death
    }
  };

  const drawGrid = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.strokeStyle = COLORS.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const camX = camera.current.x;
    const startX = Math.floor(camX / TILE_SIZE) * TILE_SIZE;
    
    // FIX: Draw vertical lines using camera Y bounds, not 0 to height
    const camY = camera.current.y;
    
    for (let x = startX - TILE_SIZE; x < camX + width + TILE_SIZE; x += TILE_SIZE) {
        ctx.moveTo(x, camY);
        ctx.lineTo(x, camY + height);
    }
    
    const startY = Math.floor(camY / TILE_SIZE) * TILE_SIZE;
    for (let y = startY - TILE_SIZE; y < camY + height + TILE_SIZE; y += TILE_SIZE) {
        ctx.moveTo(camX, y);
        ctx.lineTo(camX + width, y);
    }
    ctx.stroke();
  };

  const drawObject = (ctx: CanvasRenderingContext2D, obj: LevelObject, x: number, y: number) => {
      if (obj.type === ObjectType.START_POS) {
          if (modeRef.current === GameMode.VERIFY || modeRef.current === GameMode.VERIFY_PAUSED) return; // Hide in Verify and Verify Paused
          
          const centerX = x + TILE_SIZE/2;
          const centerY = y + TILE_SIZE/2;
          
          // Draw Diamond Shape
          ctx.beginPath();
          ctx.moveTo(centerX, centerY - 15);
          ctx.lineTo(centerX + 15, centerY);
          ctx.lineTo(centerX, centerY + 15);
          ctx.lineTo(centerX - 15, centerY);
          ctx.closePath();
          
          ctx.fillStyle = 'rgba(0, 100, 255, 0.5)';
          ctx.fill();
          ctx.strokeStyle = '#00ffff';
          ctx.lineWidth = 2;
          ctx.stroke();
          
          // Inner Diamond
          ctx.beginPath();
          ctx.moveTo(centerX, centerY - 8);
          ctx.lineTo(centerX + 8, centerY);
          ctx.lineTo(centerX, centerY + 8);
          ctx.lineTo(centerX - 8, centerY);
          ctx.closePath();
          ctx.fillStyle = '#fff';
          ctx.fill();
          
          // Text
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 8px Arial';
          ctx.textAlign = 'center';
          ctx.fillText("START POS", centerX, centerY - 20);
          
          if (obj.startPosData && !obj.startPosData.enabled) {
              // Draw X if disabled
              ctx.strokeStyle = '#ff0000';
              ctx.lineWidth = 3;
              ctx.beginPath();
              ctx.moveTo(centerX - 10, centerY - 10);
              ctx.lineTo(centerX + 10, centerY + 10);
              ctx.moveTo(centerX + 10, centerY - 10);
              ctx.lineTo(centerX - 10, centerY + 10);
              ctx.stroke();
          }
          return;
      }

      // VISUALIZE TRIGGERS (Except in Verify)
      if (obj.type === ObjectType.TRIGGER) {
          if (modeRef.current === GameMode.VERIFY || modeRef.current === GameMode.VERIFY_PAUSED) return; // Hide in Verify and Verify Paused
          
          const centerX = x + TILE_SIZE/2;
          const centerY = y + TILE_SIZE/2;

          // VISUALIZE TOUCH TRIGGER AREA (Always visible in editor/playtest if it's touch)
          if (obj.triggerData?.touchTrigger) {
              ctx.save();
              ctx.strokeStyle = '#00ffff';
              ctx.lineWidth = 2;
              // Draw a box to represent the touch zone (the "full stud")
              ctx.strokeRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
              // Small indicator inside
              ctx.fillStyle = 'rgba(0, 255, 255, 0.2)';
              ctx.fillRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
              ctx.restore();
          } else {
              // Draw Infinite Vertical Line (Standard Trigger)
              ctx.save();
              ctx.strokeStyle = COLORS.triggerLine;
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(centerX, -99999); // Infinite Y
              ctx.lineTo(centerX, 99999);
              ctx.stroke();
              ctx.restore();
          }
          
          // Draw Duration Line (Horizontal)
          if (obj.triggerData && obj.triggerData.duration > 0) {
              const length = obj.triggerData.duration * 60 * PLAYER_SPEED;
              ctx.save();
              ctx.strokeStyle = COLORS.triggerDurationLine;
              ctx.setLineDash([5, 5]);
              ctx.beginPath();
              ctx.moveTo(centerX, centerY);
              ctx.lineTo(centerX + length, centerY);
              ctx.stroke();
              
              // End Marker
              ctx.setLineDash([]);
              ctx.beginPath();
              ctx.moveTo(centerX + length, centerY - 5);
              ctx.lineTo(centerX + length, centerY + 5);
              ctx.stroke();
              ctx.restore();
          }

          // Draw Trigger Icon (Col)
          if (obj.subtype === 1) { // COL
              ctx.beginPath();
              ctx.arc(centerX - 6, centerY + 5, 5, 0, Math.PI * 2);
              ctx.fillStyle = '#ff0000'; ctx.fill();
              ctx.beginPath();
              ctx.arc(centerX + 6, centerY + 5, 5, 0, Math.PI * 2);
              ctx.fillStyle = '#00ff00'; ctx.fill();
              ctx.beginPath();
              ctx.arc(centerX, centerY - 6, 5, 0, Math.PI * 2);
              ctx.fillStyle = '#0000ff'; ctx.fill();
              
              ctx.fillStyle = '#fff';
              ctx.font = 'bold 10px Arial';
              ctx.textAlign = 'center';
              ctx.fillText("Col", centerX, centerY + 2);
              
              ctx.strokeStyle = '#fff';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.arc(centerX, centerY, 15, 0, Math.PI * 2);
              ctx.stroke();
          }
          return;
      }
      
      if (obj.type === ObjectType.BLOCK) {
          if (obj.subtype === 2) { 
              ctx.fillStyle = COLORS.objBrickFill;
              ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
              ctx.strokeStyle = '#fff';
              ctx.lineWidth = 1;
              ctx.strokeRect(x, y, TILE_SIZE, TILE_SIZE);
              ctx.beginPath();
              ctx.moveTo(x, y+10); ctx.lineTo(x+40, y+10);
              ctx.moveTo(x, y+20); ctx.lineTo(x+40, y+20);
              ctx.moveTo(x, y+30); ctx.lineTo(x+40, y+30);
              ctx.moveTo(x+20, y); ctx.lineTo(x+20, y+10);
              ctx.moveTo(x+10, y+10); ctx.lineTo(x+10, y+20);
              ctx.moveTo(x+30, y+10); ctx.lineTo(x+30, y+20);
              ctx.moveTo(x+20, y+20); ctx.lineTo(x+20, y+30);
              ctx.moveTo(x+10, y+30); ctx.lineTo(x+10, y+40);
              ctx.moveTo(x+30, y+30); ctx.lineTo(x+30, y+40);
              ctx.stroke();
          } else if (obj.subtype === 3) { 
              ctx.fillStyle = COLORS.objBlockFill;
              ctx.fillRect(x, y, TILE_SIZE, 20); // Draws Top Half
              ctx.strokeStyle = COLORS.objBlockStroke;
              ctx.lineWidth = 2;
              ctx.strokeRect(x, y, TILE_SIZE, 20);
              ctx.strokeRect(x+6, y+6, TILE_SIZE-12, 8);
          } else { 
              ctx.fillStyle = COLORS.objBlockFill;
              ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
              ctx.strokeStyle = COLORS.objBlockStroke;
              ctx.lineWidth = 2;
              ctx.strokeRect(x, y, TILE_SIZE, TILE_SIZE);
              ctx.strokeRect(x+6, y+6, TILE_SIZE-12, TILE_SIZE-12);
          }
      } else if (obj.type === ObjectType.SPIKE) {
          ctx.fillStyle = COLORS.objSpikeFill;
          ctx.strokeStyle = COLORS.objSpikeStroke;
          ctx.lineWidth = 2;
          ctx.beginPath();
          if (obj.subtype === 2) { 
              ctx.moveTo(x+10, y+TILE_SIZE);
              ctx.lineTo(x+TILE_SIZE/2, y+TILE_SIZE-15);
              ctx.lineTo(x+TILE_SIZE-10, y+TILE_SIZE);
          } else if (obj.subtype === 3) { 
              ctx.moveTo(x+2, y+TILE_SIZE);
              ctx.lineTo(x+TILE_SIZE/2, y+TILE_SIZE-15);
              ctx.lineTo(x+TILE_SIZE-2, y+TILE_SIZE);
          } else { 
              ctx.moveTo(x+5, y+TILE_SIZE);
              ctx.lineTo(x+TILE_SIZE/2, y+5);
              ctx.lineTo(x+TILE_SIZE-5, y+TILE_SIZE);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
      } else if (obj.type === ObjectType.PAD) {
          const color = obj.subtype === 1 ? COLORS.objPadPink : (obj.subtype === 2 ? COLORS.objPadYellow : (obj.subtype === 4 ? COLORS.objPadCyan : COLORS.objPadRed));
          const bg = obj.subtype === 4 ? 'rgba(0,255,255,0.3)' : (obj.subtype === 1 ? 'rgba(255,102,204,0.3)' : (obj.subtype === 2 ? 'rgba(255,255,0,0.3)' : 'rgba(255,0,0,0.3)'));
          
          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(x + 5, y + TILE_SIZE);
          if (obj.subtype === 1) ctx.quadraticCurveTo(x + TILE_SIZE/2, y + TILE_SIZE - 10, x + TILE_SIZE - 5, y + TILE_SIZE);
          else if (obj.subtype === 2 || obj.subtype === 4) ctx.quadraticCurveTo(x + TILE_SIZE/2, y + TILE_SIZE - 15, x + TILE_SIZE - 5, y + TILE_SIZE);
          else ctx.quadraticCurveTo(x + TILE_SIZE/2, y + TILE_SIZE - 20, x + TILE_SIZE - 5, y + TILE_SIZE);
          ctx.stroke();
          ctx.fillStyle = bg;
          ctx.fill();
          ctx.beginPath();
          ctx.fillStyle = color;
          const cy = obj.subtype === 1 ? y + TILE_SIZE - 5 : (obj.subtype === 2 || obj.subtype === 4 ? y + TILE_SIZE - 8 : y + TILE_SIZE - 10);
          const r = obj.subtype === 4 ? 6 : (3 + obj.subtype);
          ctx.arc(x + TILE_SIZE/2, cy, r, 0, Math.PI * 2);
          ctx.fill();
      } else if (obj.type === ObjectType.ORB) {
          const color = obj.subtype === 1 ? COLORS.objPadPink : (obj.subtype === 2 ? COLORS.objPadYellow : (obj.subtype === 4 ? COLORS.objPadCyan : COLORS.objPadRed));
          const r = obj.subtype === 1 ? 8 : (obj.subtype === 2 || obj.subtype === 4 ? 10 : 12);
          ctx.beginPath();
          ctx.arc(x + TILE_SIZE/2, y + TILE_SIZE/2, r, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(x + TILE_SIZE/2, y + TILE_SIZE/2, r + 4, 0, Math.PI * 2);
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x + TILE_SIZE/2, y + TILE_SIZE/2, r - 4, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.5)';
          ctx.fill();
      } else if (obj.type === ObjectType.PORTAL) {
          let color = COLORS.objPortalGreen;
          if (obj.subtype === 2) color = COLORS.objPortalPink;
          if (obj.subtype === 3) color = COLORS.objPortalYellow;
          if (obj.subtype === 4) color = COLORS.objPortalBlue;
          if (obj.subtype === 5) color = COLORS.objPortalGreen;

          // Use passed coordinates to determine center
          const cx = x + TILE_SIZE / 2;
          const cy = y + TILE_SIZE / 2;
          const topY = cy - 60;
          const botY = cy + 60;
          const w = 30;
          const hw = w/2;

          if (obj.subtype <= 2) {
              // GAMEMODE PORTALS (Original Blocky Hourglass)
              ctx.fillStyle = color;
              ctx.strokeStyle = '#fff';
              ctx.lineWidth = 2;
              
              ctx.beginPath();
              ctx.moveTo(cx - hw, topY);
              ctx.lineTo(cx + hw, topY);
              ctx.lineTo(cx + hw, topY + 20);
              ctx.lineTo(cx + hw - 5, cy); 
              ctx.lineTo(cx + hw, botY - 20);
              ctx.lineTo(cx + hw, botY);
              ctx.lineTo(cx - hw, botY);
              ctx.lineTo(cx - hw, botY - 20);
              ctx.lineTo(cx - hw + 5, cy); 
              ctx.lineTo(cx - hw, topY + 20);
              ctx.closePath();
              
              ctx.globalAlpha = 0.6;
              ctx.fill();
              ctx.globalAlpha = 1.0;
              ctx.stroke();
              
              // Inner ellipse
              ctx.beginPath();
              ctx.ellipse(cx, cy, 5, 40, 0, 0, Math.PI*2);
              ctx.fillStyle = '#fff';
              ctx.fill();
          } else {
              // GRAVITY PORTALS (New Tech Design)
              // Shape: Smoother, more continuous curve or angular "tech" look.
              
              ctx.fillStyle = color;
              ctx.strokeStyle = '#fff';
              ctx.lineWidth = 2;

              ctx.beginPath();
              // Top cap
              ctx.moveTo(cx - hw, topY);
              ctx.lineTo(cx + hw, topY);
              // Curve in
              ctx.bezierCurveTo(cx + hw, topY + 30, cx + 5, cy - 10, cx + 5, cy);
              // Curve out
              ctx.bezierCurveTo(cx + 5, cy + 10, cx + hw, botY - 30, cx + hw, botY);
              // Bottom cap
              ctx.lineTo(cx - hw, botY);
              // Curve back up
              ctx.bezierCurveTo(cx - hw, botY - 30, cx - 5, cy + 10, cx - 5, cy);
              ctx.bezierCurveTo(cx - 5, cy - 10, cx - hw, topY + 30, cx - hw, topY);
              ctx.closePath();

              ctx.globalAlpha = 0.6;
              ctx.fill();
              ctx.globalAlpha = 1.0;
              ctx.stroke();

              // Inner Detail (Rim)
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(cx - hw + 4, topY + 4);
              ctx.bezierCurveTo(cx - hw + 4, topY + 30, cx - 2, cy - 10, cx - 2, cy);
              ctx.bezierCurveTo(cx - 2, cy + 10, cx - hw + 4, botY - 30, cx - hw + 4, botY - 4);
              ctx.stroke();

              // Directional Arrow
              ctx.fillStyle = '#fff';
              ctx.beginPath();
              if (obj.subtype === 3) { // Yellow (Up - Reverse)
                  // Up Arrow
                  ctx.moveTo(cx, cy - 15);
                  ctx.lineTo(cx + 8, cy + 5);
                  ctx.lineTo(cx + 3, cy + 5);
                  ctx.lineTo(cx + 3, cy + 20);
                  ctx.lineTo(cx - 3, cy + 20);
                  ctx.lineTo(cx - 3, cy + 5);
                  ctx.lineTo(cx - 8, cy + 5);
              } else if (obj.subtype === 4) { // Blue (Down - Normal)
                  // Down Arrow
                  ctx.moveTo(cx, cy + 15);
                  ctx.lineTo(cx + 8, cy - 5);
                  ctx.lineTo(cx + 3, cy - 5);
                  ctx.lineTo(cx + 3, cy - 20);
                  ctx.lineTo(cx - 3, cy - 20);
                  ctx.lineTo(cx - 3, cy - 5);
                  ctx.lineTo(cx - 8, cy - 5);
              } else if (obj.subtype === 5) { // Green (Toggle)
                  // Diamond / Double arrow
                  ctx.moveTo(cx, cy - 15);
                  ctx.lineTo(cx + 8, cy);
                  ctx.lineTo(cx, cy + 15);
                  ctx.lineTo(cx - 8, cy);
              }
              ctx.closePath();
              ctx.fill();
          }

      } else if (obj.type === ObjectType.DECO) {
          if (obj.subtype === 1) { 
              ctx.fillStyle = 'rgba(255,255,255,0.7)';
              ctx.beginPath();
              ctx.arc(x + 10, y + 25, 12, 0, Math.PI * 2);
              ctx.arc(x + 22, y + 15, 15, 0, Math.PI * 2);
              ctx.arc(x + 35, y + 25, 10, 0, Math.PI * 2);
              ctx.rect(x+10, y+25, 25, 10);
              ctx.fill();
          } else if (obj.subtype === 2) { 
              ctx.fillStyle = '#118833'; 
              ctx.beginPath();
              ctx.arc(x + 12, y + 30, 10, 0, Math.PI * 2);
              ctx.arc(x + 28, y + 30, 10, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = '#22cc55';
              ctx.beginPath();
              ctx.arc(x + 20, y + 22, 12, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = '#55ee77';
              ctx.beginPath();
              ctx.arc(x + 20, y + 18, 5, 0, Math.PI * 2);
              ctx.fill();
          } else if (obj.subtype === 3) { 
              ctx.strokeStyle = '#888';
              ctx.lineWidth = 3;
              ctx.beginPath();
              ctx.ellipse(x + TILE_SIZE/2, y + 10, 5, 8, 0, 0, Math.PI * 2);
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(x + TILE_SIZE/2, y + 18);
              ctx.lineTo(x + TILE_SIZE/2, y + 22);
              ctx.stroke();
              ctx.beginPath();
              ctx.ellipse(x + TILE_SIZE/2, y + 30, 5, 8, 0, 0, Math.PI * 2);
              ctx.stroke();
          }
      }
  };

  const draw = (ctx: CanvasRenderingContext2D, width: number, height: number, mode: GameMode) => {
    // Custom Background Colors (USE DISPLAY SETTINGS FOR INTERPOLATION)
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, displaySettings.current.bgColorTop);
    grad.addColorStop(1, displaySettings.current.bgColorBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    
    // SCALE SCENE BASED ON ZOOM
    const zoom = camera.current.zoom;
    ctx.scale(zoom, zoom);
    ctx.translate(-camera.current.x, -camera.current.y);

    const isEditor = mode === GameMode.EDITOR || mode === GameMode.PAUSED;
    const drawGridLines = isEditor || mode === GameMode.PLAYTEST;
    
    // Adjust visible area calcs for zoom
    const visibleWidth = width / zoom;
    const visibleHeight = height / zoom;

    if (mode === GameMode.VERIFY && finishWallX.current < 900000) {
        // FILL INFINITE WHITE WALL FROM START POINT
        ctx.fillStyle = COLORS.endWall; // Use the same consistent alpha/color as the start
        // Fill from the wall start all the way to a very large number
        ctx.fillRect(finishWallX.current, -20000, 200000, 40000);
        
        // Optional: Keep the white stroke line to define the exact trigger point
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(finishWallX.current, -20000);
        ctx.lineTo(finishWallX.current, 20000);
        ctx.stroke();
    }

    // DRAW OBJECTS
    levelData.current.forEach(obj => {
        const x = obj.x * TILE_SIZE;
        const y = obj.y * TILE_SIZE;
        ctx.save();
        ctx.translate(x + TILE_SIZE/2, y + TILE_SIZE/2);
        ctx.rotate((obj.rotation || 0) * Math.PI / 180);
        drawObject(ctx, obj, -TILE_SIZE/2, -TILE_SIZE/2);
        ctx.restore();
        
        if (selectedObjects.current.has(obj.id)) {
            ctx.save();
            ctx.translate(x + TILE_SIZE/2, y + TILE_SIZE/2);
            ctx.rotate((obj.rotation || 0) * Math.PI / 180);
            ctx.translate(-TILE_SIZE/2, -TILE_SIZE/2);
            ctx.strokeStyle = isPastedSelection.current ? COLORS.pasteStroke : COLORS.selectionStroke;
            ctx.fillStyle = isPastedSelection.current ? COLORS.pasteFill : COLORS.selectionFill;
            ctx.lineWidth = 2;
            ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
            ctx.strokeRect(0, 0, TILE_SIZE, TILE_SIZE);
            ctx.restore();
        }
        
        if (showHitboxesRef.current) {
            // SKIP HITBOX VISUALIZATION FOR TRIGGERS AND DECO
            if (obj.type === ObjectType.TRIGGER || obj.type === ObjectType.DECO || obj.type === ObjectType.START_POS) return; 

            const hb = getLocalHitbox(obj.type, obj.subtype);
            if (hb.w > 0) { 
                ctx.save();
                ctx.translate(x + TILE_SIZE/2, y + TILE_SIZE/2);
                ctx.rotate((obj.rotation || 0) * Math.PI / 180);
                let color = 'rgba(255,0,0,0.8)';
                if (obj.type === ObjectType.BLOCK) color = 'rgba(0,0,255,0.8)';
                else if (obj.type === ObjectType.PAD || obj.type === ObjectType.ORB || obj.type === ObjectType.PORTAL) color = 'rgba(255,255,0,0.8)';
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                // Correctly offset from center to top-left relative to tile origin
                ctx.strokeRect(hb.x - TILE_SIZE/2, hb.y - TILE_SIZE/2, hb.w, hb.h);
                ctx.restore();
            }
        }
    });

    // Draw Particles (BEFORE Ground)
    particles.current.forEach(p => {
        ctx.save();
        ctx.globalAlpha = p.life;
        if (p.type === 'ring') {
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size || 10, 0, Math.PI*2);
            ctx.stroke();
        } else {
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size || 4, 0, Math.PI*2);
            ctx.fill();
        }
        ctx.restore();
    });

    const floorAlpha = isEditor ? 0.3 : 1.0;
    
    // CUSTOM GROUND COLOR (Use Display Settings)
    ctx.globalAlpha = floorAlpha;
    ctx.fillStyle = displaySettings.current.groundColor;
    ctx.fillRect(camera.current.x, activeFloorY.current, visibleWidth, 1000);
    ctx.globalAlpha = 1.0;

    // CUSTOM LINE COLOR (Use Display Settings)
    ctx.strokeStyle = displaySettings.current.lineColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(camera.current.x, activeFloorY.current);
    ctx.lineTo(camera.current.x + visibleWidth, activeFloorY.current);
    ctx.stroke();

    // Draw Default Ground Reference (if displaced)
    if ((mode === GameMode.EDITOR || mode === GameMode.PAUSED) && Math.abs(activeFloorY.current - FLOOR_Y) > 10) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 10]);
        ctx.beginPath();
        ctx.moveTo(camera.current.x, FLOOR_Y);
        ctx.lineTo(camera.current.x + visibleWidth, FLOOR_Y);
        ctx.stroke();
        ctx.setLineDash([]);
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = 'bold 12px monospace';
        ctx.fillText("DEFAULT GROUND", camera.current.x + 20, FLOOR_Y - 10);
    }
    
    // Draw Ceiling (if visible/active)
    // Only draw if targetCeiling is active or it's currently animating away but still visible
    if (activeCeilingY.current > camera.current.y - 1000) {
        ctx.globalAlpha = floorAlpha;
        ctx.fillStyle = displaySettings.current.groundColor; 
        ctx.fillRect(camera.current.x, activeCeilingY.current - 1000, visibleWidth, 1000);
        ctx.globalAlpha = 1.0;
        
        ctx.strokeStyle = displaySettings.current.lineColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(camera.current.x, activeCeilingY.current);
        ctx.lineTo(camera.current.x + visibleWidth, activeCeilingY.current);
        ctx.stroke();
    }
    
    if (drawGridLines) {
       drawGrid(ctx, visibleWidth, visibleHeight);
    }

    if (mode === GameMode.EDITOR || mode === GameMode.PAUSED) {
        const startY = 11 * TILE_SIZE;
        ctx.fillStyle = 'rgba(0, 255, 0, 0.2)';
        ctx.fillRect(0, startY, TILE_SIZE, TILE_SIZE);
        ctx.strokeStyle = '#0f0';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, startY, TILE_SIZE, TILE_SIZE);
    }

    // DRAW DELETE PREVIEW
    if (selectedToolRef.current.type === ObjectType.DELETE && (mode === GameMode.EDITOR || mode === GameMode.PAUSED)) {
        const currentWorldX = (mouse.current.x / zoom) + camera.current.x;
        const currentWorldY = (mouse.current.y / zoom) + camera.current.y;
        const gX = Math.floor(currentWorldX / TILE_SIZE) * TILE_SIZE;
        const gY = Math.floor(currentWorldY / TILE_SIZE) * TILE_SIZE;

        ctx.save();
        ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
        ctx.fillRect(gX, gY, TILE_SIZE, TILE_SIZE);
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 2;
        ctx.strokeRect(gX, gY, TILE_SIZE, TILE_SIZE);
        ctx.restore();
    }

    // DRAW PLACEMENT PREVIEW
    if ((mode === GameMode.EDITOR || mode === GameMode.PAUSED) && 
        selectedToolRef.current.type !== ObjectType.TOOL && 
        selectedToolRef.current.type !== ObjectType.DELETE) {
            
        const currentWorldX = (mouse.current.x / zoom) + camera.current.x;
        const currentWorldY = (mouse.current.y / zoom) + camera.current.y;
        
        const gX = Math.floor(currentWorldX / TILE_SIZE) * TILE_SIZE;
        const gY = Math.floor(currentWorldY / TILE_SIZE) * TILE_SIZE;

        const previewObj: LevelObject = {
            id: 'preview',
            x: 0, 
            y: 0,
            type: selectedToolRef.current.type,
            subtype: selectedToolRef.current.subtype,
            rotation: lastToolRotation.current, 
            triggerData: selectedToolRef.current.type === ObjectType.TRIGGER ? { target: 'bgColorTop', color: '#ff0000', duration: 0.5, touchTrigger: false } : undefined,
            startPosData: selectedToolRef.current.type === ObjectType.START_POS ? { mode: VehicleMode.CUBE, reverseGravity: false, enabled: true } : undefined
        };

        // Don't show preview for Start Pos if X < 0
        if (!(selectedToolRef.current.type === ObjectType.START_POS && gX < 0)) {
            ctx.save();
            ctx.globalAlpha = 0.5;
            ctx.translate(gX + TILE_SIZE/2, gY + TILE_SIZE/2);
            if (lastToolRotation.current) ctx.rotate(lastToolRotation.current * Math.PI / 180);
            drawObject(ctx, previewObj, -TILE_SIZE/2, -TILE_SIZE/2);
            ctx.restore();
        }
    }

    // DRAW PLAYER
    if (mode !== GameMode.EDITOR && mode !== GameMode.PAUSED) {
        const p = player.current;
        if (!p.dead) {
             ctx.save();
             // Translate to center of player for rotation
             ctx.translate(p.x + p.w/2, p.y + p.h/2);
             ctx.rotate(p.rotation);
             
             if (p.vehicle === VehicleMode.CUBE) {
                 // Draw Cube centered
                 ctx.fillStyle = COLORS.playerFill; // yellow
                 ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
                 
                 // Inner detail (blue square)
                 ctx.fillStyle = COLORS.playerDetail; // cyan
                 const innerSize = p.w / 2.5;
                 ctx.fillRect(-innerSize/2, -innerSize/2, innerSize, innerSize);
                 
                 // Outline
                 ctx.strokeStyle = 'black';
                 ctx.lineWidth = 2;
                 ctx.strokeRect(-p.w/2, -p.h/2, p.w, p.h);
                 
                 // Eyes Removed
             } else {
                 // Draw Ship
                 ctx.scale(1, p.gravityReversed ? -1 : 1);
                 
                 // SHIP BODY (Sled shape)
                 ctx.fillStyle = COLORS.playerFill;
                 ctx.strokeStyle = 'black';
                 ctx.lineWidth = 2;
                 
                 ctx.beginPath();
                 ctx.moveTo(p.w/2 + 6, 0); // Nose tip
                 ctx.quadraticCurveTo(p.w/2 - 5, p.h/2 + 2, -p.w/2 - 2, p.h/2); // Bottom curve
                 ctx.lineTo(-p.w/2 - 6, 0); // Tail point
                 ctx.lineTo(-p.w/2 - 6, -8); // Tail top
                 ctx.lineTo(-p.w/2, -8); // Back of cockpit
                 ctx.lineTo(-p.w/2, 8); // Cockpit floor start
                 ctx.lineTo(p.w/2 - 8, 8); // Cockpit floor end
                 ctx.lineTo(p.w/2 - 8, -2); // Front of cockpit
                 ctx.closePath();
                 ctx.fill();
                 ctx.stroke();

                 // Side Detail
                 ctx.fillStyle = COLORS.playerDetail;
                 ctx.beginPath();
                 ctx.moveTo(-p.w/2 + 2, 10);
                 ctx.lineTo(p.w/2 - 12, 10);
                 ctx.lineTo(p.w/2 - 16, 15);
                 ctx.lineTo(-p.w/2 + 6, 15);
                 ctx.closePath();
                 ctx.fill();
                 
                 // MINI CUBE
                 const miniScale = 0.5;
                 const ms = p.w * miniScale;
                 const my = -1; // Position so it sits on floor (y=8 approx)
                 const mx = -ms/2 - 5; // Move back by 5px

                 ctx.fillStyle = COLORS.playerFill;
                 ctx.fillRect(mx, my - ms/2, ms, ms);
                 
                 ctx.fillStyle = COLORS.playerDetail;
                 const mis = ms / 2.5;
                 ctx.fillRect(mx + (ms - mis)/2, my - mis/2, mis, mis);
                 
                 ctx.strokeStyle = 'black';
                 ctx.lineWidth = 2;
                 ctx.strokeRect(mx, my - ms/2, ms, ms);
             }
             
             ctx.restore();
        }
    }
    
    // Draw Death Markers
    deathMarkers.current.forEach(m => {
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 3;
        const size = 10;
        ctx.beginPath();
        ctx.moveTo(m.x - size, m.y - size);
        ctx.lineTo(m.x + size, m.y + size);
        ctx.moveTo(m.x + size, m.y - size);
        ctx.lineTo(m.x - size, m.y + size);
        ctx.stroke();
    });

    // Trail
    if (trail.current.length > 1) {
        ctx.strokeStyle = COLORS.trail;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(trail.current[0].x, trail.current[0].y);
        for (let i = 1; i < trail.current.length; i++) {
             ctx.lineTo(trail.current[i].x, trail.current[i].y);
        }
        ctx.stroke();
    }

    // DRAW SELECT BOX
    if (selectedToolRef.current.type === ObjectType.TOOL && boxSelectStart.current && (mode === GameMode.EDITOR || mode === GameMode.PAUSED)) {
        const startX = boxSelectStart.current.x;
        const startY = boxSelectStart.current.y;
        
        // Convert mouse current position to world coords
        const currentWorldX = (mouse.current.x / zoom) + camera.current.x;
        const currentWorldY = (mouse.current.y / zoom) + camera.current.y;
        
        const w = currentWorldX - startX;
        const h = currentWorldY - startY;
        
        ctx.save();
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 1 / zoom; 
        ctx.setLineDash([5 / zoom, 5 / zoom]);
        ctx.strokeRect(startX, startY, w, h);
        ctx.fillStyle = 'rgba(0, 255, 0, 0.1)';
        ctx.fillRect(startX, startY, w, h);
        ctx.restore();
    }

    ctx.restore();
  };

  return (
    <canvas 
        ref={canvasRef} 
        className="block w-full h-full bg-black touch-none select-none"
        onContextMenu={(e) => e.preventDefault()}
    />
  );
});

export default GameEngine;