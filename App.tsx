import React, { useState, useRef, useEffect } from 'react';
import GameEngine, { GameEngineRef } from './components/GameEngine';
import UIOverlay from './components/UIOverlay';
import { GameMode, ObjectType, LevelSettings, TriggerData, LevelData, StartPosData } from './types';
import { DEFAULT_LEVEL_SETTINGS } from './constants';

const App: React.FC = () => {
  const [mode, setMode] = useState<GameMode>(GameMode.EDITOR);
  const [selectedTool, setSelectedTool] = useState<{ type: ObjectType; subtype: number }>({ type: ObjectType.BLOCK, subtype: 1 });
  const [selectedCount, setSelectedCount] = useState(0);
  const [hasBlockSelected, setHasBlockSelected] = useState(false);
  const [selectedTriggerId, setSelectedTriggerId] = useState<string | undefined>(undefined);
  const [selectedTriggerData, setSelectedTriggerData] = useState<TriggerData | undefined>(undefined);
  const [selectedStartPosData, setSelectedStartPosData] = useState<StartPosData | undefined>(undefined);
  
  const [showHitboxes, setShowHitboxes] = useState(false);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [showSettings, setShowSettings] = useState(false);
  const [currentSettings, setCurrentSettings] = useState<LevelSettings>(DEFAULT_LEVEL_SETTINGS);
  const [wasStartPosUsed, setWasStartPosUsed] = useState(false);
  
  const engineRef = useRef<GameEngineRef>(null);

  // Load level on start
  useEffect(() => {
    const saved = localStorage.getItem('geo-architect-v1');
    if (saved && engineRef.current) {
      try {
        const json = JSON.parse(saved);
        engineRef.current.setLevel(json);
        if (json.settings) setCurrentSettings(json.settings);
      } catch (e) {
        console.error("Failed to load save", e);
      }
    }
  }, []);

  const handleModeChange = (newMode: GameMode) => {
    const isResumingPlaytest = newMode === GameMode.PLAYTEST && mode === GameMode.PAUSED;
    const isResumingVerify = newMode === GameMode.VERIFY && mode === GameMode.VERIFY_PAUSED;
    
    setMode(newMode);
    
    if (newMode === GameMode.PLAYTEST) {
       if (!isResumingPlaytest) engineRef.current?.resetPlayer(false);
    } else if (newMode === GameMode.VERIFY) {
       if (!isResumingVerify) engineRef.current?.resetPlayer(true);
    }
  };

  const handleToolSelect = (type: ObjectType, subtype: number) => {
    setSelectedTool({ type, subtype });
  };

  // Keyboard Shortcuts
  useEffect(() => {
     const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
           if (showSettings) {
             setShowSettings(false);
             return;
           }
           if (mode === GameMode.PLAYTEST) handleModeChange(GameMode.EDITOR);
           if (mode === GameMode.VERIFY) handleModeChange(GameMode.VERIFY_PAUSED);
           if (mode === GameMode.VERIFY_PAUSED) handleModeChange(GameMode.VERIFY);
        }
        if (e.key.toLowerCase() === 'p') {
           if (mode === GameMode.PLAYTEST) handleModeChange(GameMode.PAUSED);
           else if (mode === GameMode.PAUSED) handleModeChange(GameMode.PLAYTEST);
        }
     };
     window.addEventListener('keydown', handler);
     return () => window.removeEventListener('keydown', handler);
  }, [mode, showSettings]);

  const handleOpenSettings = () => {
      if (engineRef.current) {
          setCurrentSettings(engineRef.current.getLevel().settings);
          setShowSettings(true);
      }
  };

  const handleUpdateSettings = (settings: Partial<LevelSettings>) => {
      if (engineRef.current) {
          engineRef.current.updateSettings(settings);
          setCurrentSettings(prev => ({ ...prev, ...settings }));
      }
  };

  const handleUpdateTrigger = (data: Partial<TriggerData>) => {
      if (engineRef.current && selectedTriggerId) {
          engineRef.current.updateSelectedTrigger(data);
          setSelectedTriggerData(prev => prev ? { ...prev, ...data } : undefined);
      }
  };

  const handleUpdateStartPos = (data: Partial<StartPosData>) => {
      if (engineRef.current && selectedTriggerId) { // Reusing selectedTriggerId as general object ID holder
          engineRef.current.updateSelectedStartPos(data);
          setSelectedStartPosData(prev => prev ? { ...prev, ...data } : undefined);
      }
  };

  const handleClearLevel = () => {
      if (engineRef.current) {
          engineRef.current.clearLevel();
          // Reset selection state
          setSelectedCount(0);
          setHasBlockSelected(false);
          setSelectedTriggerId(undefined);
          setSelectedTriggerData(undefined);
          setSelectedStartPosData(undefined);
      }
  };

  const handleExport = () => {
      if (!engineRef.current) return;
      const data = engineRef.current.getLevel();
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement("a");
      link.href = url;
      link.download = "level-data.json";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
  };

  const handleImport = (data: any) => {
      if (engineRef.current) {
          let objects = Array.isArray(data) ? data : (data.objects || []);
          let settings = Array.isArray(data) ? undefined : data.settings;

          // Safety Checks & Sanitization
          const sanitizedObjects = objects.filter((obj: any) => {
              // Rule 3: Exclude Start Pos behind start (x < 0)
              if (obj.type === ObjectType.START_POS && obj.x < 0) {
                  return false;
              }
              return true;
          }).map((obj: any) => {
              const newObj = { ...obj };
              
              // Rule 1: Reset Trigger Rotation
              if (newObj.type === ObjectType.TRIGGER) {
                  newObj.rotation = 0;
              }
              
              // Rule 2: Snap Block Rotation to nearest 90
              if (newObj.type === ObjectType.BLOCK) {
                  const currentRot = newObj.rotation || 0;
                  newObj.rotation = Math.round(currentRot / 90) * 90;
              }
              
              return newObj;
          });

          const sanitizedData = {
              objects: sanitizedObjects,
              settings: settings || DEFAULT_LEVEL_SETTINGS
          };

          // Pass true to keep history, enabling undo
          engineRef.current.setLevel(sanitizedData, true);
          if (sanitizedData.settings) setCurrentSettings(sanitizedData.settings);
          
          // Reset selection
          setSelectedCount(0);
          setHasBlockSelected(false);
          setSelectedTriggerId(undefined);
          setSelectedTriggerData(undefined);
          setSelectedStartPosData(undefined);
      }
  };

  const onSelectionChange = (count: number, hasBlock: boolean, selectedId?: string) => {
      setSelectedCount(count);
      setHasBlockSelected(hasBlock);
      
      if (count === 1 && selectedId && engineRef.current) {
          const obj = engineRef.current.getSelectedObject();
          if (obj) {
              if (obj.type === ObjectType.TRIGGER) {
                  setSelectedTriggerId(obj.id);
                  setSelectedTriggerData(obj.triggerData);
                  setSelectedStartPosData(undefined);
              } else if (obj.type === ObjectType.START_POS) {
                  setSelectedTriggerId(obj.id); // Reuse ID
                  setSelectedStartPosData(obj.startPosData);
                  setSelectedTriggerData(undefined);
              } else {
                  setSelectedTriggerId(undefined);
                  setSelectedTriggerData(undefined);
                  setSelectedStartPosData(undefined);
              }
          }
      } else {
          setSelectedTriggerId(undefined);
          setSelectedTriggerData(undefined);
          setSelectedStartPosData(undefined);
      }
  };

  return (
    <div className="w-screen h-screen relative bg-black overflow-hidden">
      <GameEngine 
        ref={engineRef}
        mode={mode} 
        onModeChange={handleModeChange}
        selectedTool={selectedTool}
        onSelectionChange={onSelectionChange}
        showHitboxes={showHitboxes}
        onHistoryChange={(canUndo, canRedo) => setHistoryState({ canUndo, canRedo })}
        onCompletion={(used) => setWasStartPosUsed(used)}
      />
      
      <UIOverlay 
        mode={mode}
        onSetMode={handleModeChange}
        selectedTool={selectedTool}
        onSelectTool={handleToolSelect}
        selectedCount={selectedCount}
        onMoveSelection={(dx, dy) => engineRef.current?.moveSelection(dx, dy)}
        onRotateSelection={(angle, relative) => engineRef.current?.rotateSelection(angle, relative)}
        onDeleteSelection={() => engineRef.current?.deleteSelection()}
        onDeselect={() => engineRef.current?.deselectAll()}
        onDuplicateSelection={() => engineRef.current?.duplicateSelection()}
        onClearLevel={handleClearLevel}
        onExport={handleExport}
        onImport={handleImport}
        onSave={() => {}}
        showHitboxes={showHitboxes}
        onToggleHitboxes={() => setShowHitboxes(!showHitboxes)}
        onUndo={() => engineRef.current?.undo()}
        onRedo={() => engineRef.current?.redo()}
        canUndo={historyState.canUndo}
        canRedo={historyState.canRedo}
        onRestartVerify={() => {
            engineRef.current?.resetPlayer(true);
            setMode(GameMode.VERIFY);
        }}
        hasBlockSelected={hasBlockSelected}
        showSettings={showSettings}
        onOpenSettings={handleOpenSettings}
        onCloseSettings={() => setShowSettings(false)}
        currentSettings={currentSettings}
        onUpdateSettings={handleUpdateSettings}
        
        selectedTriggerId={selectedTriggerId}
        selectedTriggerData={selectedTriggerData}
        onUpdateTrigger={handleUpdateTrigger}
        
        selectedStartPosData={selectedStartPosData}
        onUpdateStartPos={handleUpdateStartPos}
        wasStartPosUsed={wasStartPosUsed}
      />
    </div>
  );
};

export default App;
