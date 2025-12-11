import React, { useState, useRef, useEffect } from 'react';
import { GameMode, ObjectType, LevelSettings, VehicleMode, TriggerData, TriggerTarget, LevelData, StartPosData } from '../types';
import { Play, Square, Trash2, MousePointer2, CheckCircle2, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Eye, EyeOff, Undo, Redo, Copy, RotateCw, RotateCcw, Pause, Cloud, Trees, Settings as SettingsIcon, X, Hand, Zap, Triangle, Circle, Hexagon, Flag, Download, Upload, FileJson, ChevronLeft, ChevronRight, XCircle } from 'lucide-react';
import { DEFAULT_LEVEL_SETTINGS, COLORS } from '../constants';

interface UIProps {
  mode: GameMode;
  onSetMode: (m: GameMode) => void;
  selectedTool: { type: ObjectType; subtype: number };
  onSelectTool: (type: ObjectType, subtype: number) => void;
  selectedCount: number;
  onMoveSelection: (dx: number, dy: number) => void;
  onDeleteSelection: () => void;
  onDeselect: () => void;
  onDuplicateSelection: () => void;
  onClearLevel: () => void;
  onExport: () => void;
  onImport: (data: LevelData) => void;
  onSave: () => void;
  showHitboxes: boolean;
  onToggleHitboxes: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onRestartVerify: () => void;
  onRotateSelection: (angle: number, relative: boolean) => void;
  hasBlockSelected: boolean;
  
  showSettings: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  currentSettings: LevelSettings;
  onUpdateSettings: (s: Partial<LevelSettings>) => void;
  
  selectedTriggerId?: string;
  selectedTriggerData?: TriggerData;
  onUpdateTrigger?: (data: Partial<TriggerData>) => void;
  
  selectedStartPosData?: StartPosData;
  onUpdateStartPos?: (data: Partial<StartPosData>) => void;
}

const ColorInput = ({ label, value, onChange, onReset }: { label: string, value: string, onChange: (val: string) => void, onReset: () => void }) => (
    <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold text-gray-400 uppercase">{label}</label>
        <div className="flex gap-1 h-7">
            <input 
                type="color" 
                value={value} 
                onChange={(e) => onChange(e.target.value)}
                className="w-8 h-full rounded cursor-pointer border-none p-0 bg-transparent" 
            />
            <input 
                type="text" 
                value={value} 
                onChange={(e) => onChange(e.target.value)}
                className="flex-1 bg-gray-800 text-white text-[10px] rounded border border-gray-600 px-1 font-mono outline-none uppercase"
            />
            <button onClick={onReset} className="px-2 bg-gray-700 hover:bg-gray-600 rounded text-white text-[10px] flex items-center justify-center" title="Reset to default">
                <RotateCcw size={12}/>
            </button>
        </div>
    </div>
);

const ToolBtn = ({ active, onClick, children }: { active: boolean, onClick: () => void, children?: React.ReactNode }) => (
    <button 
        onClick={onClick} 
        className={`w-12 h-12 rounded-lg border-2 transition-all p-1 flex items-center justify-center relative overflow-hidden ${active ? 'border-green-400 bg-green-900/40 shadow-[0_0_10px_rgba(74,222,128,0.3)] scale-105 z-10' : 'border-white/10 bg-black/40 hover:bg-black/60 hover:border-white/30'}`}
    >
        {children}
    </button>
);

const CreditsOverlay = ({ onClose }: { onClose: () => void }) => {
    const [step, setStep] = useState(0); // 0: Fade In, 1: Gradient & Scroll, 2: Fade Out

    useEffect(() => {
        // Step 0 -> 1 after fade in
        const t1 = setTimeout(() => setStep(1), 100); 
        // Close after sequence
        const t2 = setTimeout(() => setStep(2), 5000); 
        const t3 = setTimeout(onClose, 6000);
        return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    }, [onClose]);

    return (
        <div className={`fixed inset-0 z-[100] transition-opacity duration-1000 ease-in-out pointer-events-auto flex items-center justify-center overflow-hidden ${step === 0 ? 'opacity-0 bg-black' : step === 2 ? 'opacity-0' : 'opacity-100'}`} style={{ backgroundColor: step === 1 ? 'transparent' : 'black' }}>
            {step === 1 && (
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-purple-900 via-black to-black animate-pulse"></div>
            )}
            <div className={`relative z-10 text-center transition-all duration-[4000ms] ease-linear transform ${step === 1 ? 'translate-y-[-10vh]' : 'translate-y-[50vh]'}`}>
                <h2 className="text-3xl font-pusab text-purple-400 mb-4 drop-shadow-[0_0_10px_rgba(168,85,247,0.8)]">Made and developed by:<br/>xD89 aka: Hunter</h2>
                <p className="text-xl font-mono text-purple-200 opacity-80">Help with vibe AI or sum</p>
            </div>
        </div>
    );
};

const UIOverlay: React.FC<UIProps> = ({ 
  mode, onSetMode, selectedTool, onSelectTool, 
  selectedCount, onMoveSelection, onDeleteSelection, onDeselect, onDuplicateSelection,
  onClearLevel, onExport, onImport, onSave, showHitboxes, onToggleHitboxes, onUndo, onRedo, canUndo, canRedo, onRestartVerify,
  onRotateSelection, hasBlockSelected,
  showSettings, onOpenSettings, onCloseSettings, currentSettings, onUpdateSettings,
  selectedTriggerId, selectedTriggerData, onUpdateTrigger,
  selectedStartPosData, onUpdateStartPos
}) => {
  const [tab, setTab] = useState<'blocks' | 'hazards' | 'special' | 'deco' | 'triggers' | 'tools'>('blocks');
  const [specialPage, setSpecialPage] = useState(0); 
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [showCredits, setShowCredits] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isToolActive = (t: ObjectType, s: number) => selectedTool.type === t && selectedTool.subtype === s;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
              const text = event.target?.result as string;
              setImportText(text);
          };
          reader.readAsText(file);
      }
  };

  const handleImportSubmit = () => {
      try {
          const data = JSON.parse(importText);
          if (data && (data.objects || Array.isArray(data))) {
              onImport(data);
              setShowImportModal(false);
              setImportText('');
          } else {
              alert("Invalid Level Data format.");
          }
      } catch (err) {
          alert("Failed to parse JSON. Please check the text.");
      }
  };

  const SPECIAL_TITLES = ['PADS', 'ORBS', 'GAMEMODES', 'GRAVITY'];

  const cycleSpecialPage = (direction: number) => {
      setSpecialPage(prev => {
          let next = prev + direction;
          if (next < 0) next = 3;
          if (next > 3) next = 0;
          return next;
      });
  };

  if (showCredits) {
      return <CreditsOverlay onClose={() => setShowCredits(false)} />;
  }

  if (showImportModal) {
      return (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/80 backdrop-blur-sm animate-in fade-in zoom-in duration-200 pointer-events-auto">
             <div className="bg-[#1a1a1a] border-2 border-blue-500 rounded-xl p-6 w-[500px] shadow-2xl relative">
                 <button onClick={() => setShowImportModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white"><X size={24}/></button>
                 
                 <h2 className="text-2xl font-pusab text-blue-400 mb-6 border-b border-gray-700 pb-2">Import Level</h2>
                 
                 <div className="space-y-4">
                     <div>
                         <label className="text-sm font-bold text-gray-400 block mb-2">UPLOAD FILE</label>
                         <input 
                            type="file" 
                            accept=".json" 
                            ref={fileInputRef} 
                            onChange={handleFileUpload}
                            className="hidden" 
                         />
                         <button 
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full py-2 bg-gray-800 border border-gray-600 rounded text-gray-300 hover:bg-gray-700 flex items-center justify-center gap-2"
                         >
                             <Upload size={16}/> Select .json File
                         </button>
                     </div>
                     
                     <div className="text-center text-gray-500 text-xs">- OR PASTE DATA -</div>

                     <div>
                         <textarea 
                            value={importText}
                            onChange={(e) => setImportText(e.target.value)}
                            className="w-full h-32 bg-black/50 border border-gray-700 rounded p-2 text-xs font-mono text-green-400 outline-none focus:border-blue-500 resize-none"
                            placeholder='Paste level JSON data here...'
                         />
                     </div>
                 </div>
                 
                 <div className="mt-6 flex justify-end gap-2">
                     <button onClick={() => setShowImportModal(false)} className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg">Cancel</button>
                     <button onClick={handleImportSubmit} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-6 rounded-lg">Load Level</button>
                 </div>
             </div>
        </div>
      );
  }

  if (showSettings) {
      return (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/80 backdrop-blur-sm animate-in fade-in zoom-in duration-200 pointer-events-auto">
             <div className="bg-[#1a1a1a] border-2 border-blue-500 rounded-xl p-6 w-[500px] shadow-2xl relative max-h-[90vh] overflow-y-auto">
                 <button onClick={onCloseSettings} className="absolute top-4 right-4 text-gray-400 hover:text-white"><X size={24}/></button>
                 
                 <h2 className="text-2xl font-pusab text-blue-400 mb-6 border-b border-gray-700 pb-2">Level Settings</h2>
                 
                 <div className="space-y-6">
                     <div>
                         <label className="text-sm font-bold text-gray-400 block mb-2">START MODE</label>
                         <div className="flex gap-4">
                             <button onClick={() => onUpdateSettings({ startMode: VehicleMode.CUBE })} className={`flex-1 py-3 rounded-lg font-bold border transition-all ${currentSettings.startMode === VehicleMode.CUBE ? 'bg-blue-600 border-blue-400 text-white' : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'}`}>CUBE</button>
                             <button onClick={() => onUpdateSettings({ startMode: VehicleMode.SHIP })} className={`flex-1 py-3 rounded-lg font-bold border transition-all ${currentSettings.startMode === VehicleMode.SHIP ? 'bg-pink-600 border-pink-400 text-white' : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'}`}>SHIP</button>
                         </div>
                     </div>
                     <div>
                         <label className="text-sm font-bold text-gray-400 block mb-2">GRAVITY</label>
                         <button 
                            onClick={() => onUpdateSettings({ startReverseGravity: !currentSettings.startReverseGravity })} 
                            className={`w-full py-2 rounded-lg font-bold border transition-all flex items-center justify-center gap-2 ${currentSettings.startReverseGravity ? 'bg-purple-600 border-purple-400 text-white' : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'}`}
                         >
                             {currentSettings.startReverseGravity ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
                             {currentSettings.startReverseGravity ? 'FLIP START' : 'NORMAL START'}
                         </button>
                     </div>
                     <div>
                        <label className="text-sm font-bold text-gray-400 block mb-3">LEVEL COLORS</label>
                        <div className="grid grid-cols-2 gap-4">
                            <ColorInput label="BG Top (Color 2)" value={currentSettings.bgColorTop} onChange={(c) => onUpdateSettings({ bgColorTop: c })} onReset={() => onUpdateSettings({ bgColorTop: DEFAULT_LEVEL_SETTINGS.bgColorTop })} />
                            <ColorInput label="BG Bottom (Color 1)" value={currentSettings.bgColorBottom} onChange={(c) => onUpdateSettings({ bgColorBottom: c })} onReset={() => onUpdateSettings({ bgColorBottom: DEFAULT_LEVEL_SETTINGS.bgColorBottom })} />
                            <ColorInput label="Ground Color" value={currentSettings.groundColor} onChange={(c) => onUpdateSettings({ groundColor: c })} onReset={() => onUpdateSettings({ groundColor: DEFAULT_LEVEL_SETTINGS.groundColor })} />
                            <ColorInput label="Line Color" value={currentSettings.lineColor} onChange={(c) => onUpdateSettings({ lineColor: c })} onReset={() => onUpdateSettings({ lineColor: DEFAULT_LEVEL_SETTINGS.lineColor })} />
                        </div>
                     </div>
                     
                     <div>
                         <label className="text-sm font-bold text-gray-400 block mb-3">LEVEL ACTIONS</label>
                         <div className="flex gap-2">
                             <button onClick={onClearLevel} className="flex-1 bg-red-900/40 hover:bg-red-900/60 border border-red-700 text-red-300 py-3 rounded-lg font-bold flex flex-col items-center justify-center gap-1">
                                 <Trash2 size={18}/>
                                 <span className="text-[10px]">CLEAR ALL</span>
                             </button>
                             <button onClick={onExport} className="flex-1 bg-blue-900/40 hover:bg-blue-900/60 border border-blue-700 text-blue-300 py-3 rounded-lg font-bold flex flex-col items-center justify-center gap-1">
                                 <Download size={18}/>
                                 <span className="text-[10px]">EXPORT</span>
                             </button>
                             <button onClick={() => setShowImportModal(true)} className="flex-1 bg-orange-900/40 hover:bg-orange-900/60 border border-orange-700 text-orange-300 py-3 rounded-lg font-bold flex flex-col items-center justify-center gap-1">
                                 <Upload size={18}/>
                                 <span className="text-[10px]">IMPORT</span>
                             </button>
                         </div>
                     </div>
                 </div>
                 
                 <div className="mt-8 pt-4 border-t border-gray-700 flex justify-end">
                     <button onClick={onCloseSettings} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-6 rounded-lg">Done</button>
                 </div>
             </div>
        </div>
      );
  }

  if (mode === GameMode.COMPLETE) {
    return (
      <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/50 backdrop-blur-sm animate-in fade-in zoom-in duration-300 pointer-events-auto">
         <div className="bg-black/90 border-2 border-green-500 rounded-2xl p-8 text-center max-w-md w-full shadow-[0_0_50px_rgba(0,255,0,0.3)]">
            <h2 className="text-4xl font-pusab text-green-400 mb-2 drop-shadow-[0_4px_0_rgba(0,0,0,1)]">LEVEL VERIFIED!</h2>
            {showHitboxes ? (
                <p className="text-yellow-300 mb-8 font-medium">Warning: Hitboxes were enabled.<br/>Now try without hitboxes to truly verify!</p>
            ) : (
                <p className="text-gray-300 mb-8 font-medium">The level is complete and ready to share.</p>
            )}
            <div className="flex flex-col gap-4">
               <button onClick={() => onSetMode(GameMode.EDITOR)} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-6 rounded-lg shadow-[0_4px_0_#1e40af] active:translate-y-1 active:shadow-none transition-all">Keep Editing</button>
               <button onClick={() => onSetMode(GameMode.VERIFY)} className="bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-6 rounded-lg shadow-[0_4px_0_#166534] active:translate-y-1 active:shadow-none transition-all">Replay</button>
            </div>
         </div>
      </div>
    );
  }
  
  if (mode === GameMode.VERIFY_PAUSED) {
     return (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/90 backdrop-blur-sm pointer-events-auto">
           <div className="bg-black/95 border-2 border-blue-500 rounded-2xl p-8 text-center max-w-md w-full shadow-2xl">
              <h2 className="text-3xl font-pusab text-blue-400 mb-6">PAUSED</h2>
              <div className="flex flex-col gap-4">
                 <button onClick={() => onSetMode(GameMode.VERIFY)} className="bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-6 rounded-lg shadow-[0_4px_0_#166534] active:translate-y-1 active:shadow-none">Resume</button>
                 <button onClick={onRestartVerify} className="bg-yellow-600 hover:bg-yellow-500 text-white font-bold py-3 px-6 rounded-lg shadow-[0_4px_0_#854d0e] active:translate-y-1 active:shadow-none">Restart Verification</button>
                 <button onClick={() => onSetMode(GameMode.EDITOR)} className="bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-6 rounded-lg shadow-[0_4px_0_#991b1b] active:translate-y-1 active:shadow-none">Exit to Editor</button>
              </div>
           </div>
        </div>
     );
  }

  const isEditor = mode === GameMode.EDITOR || mode === GameMode.PAUSED;
  const isPlaytest = mode === GameMode.PLAYTEST;
  const isVerify = mode === GameMode.VERIFY;
  const isPaused = mode === GameMode.PAUSED;

  return (
    <div className={`absolute inset-0 pointer-events-none ${isVerify ? 'cursor-none' : ''}`}>
      
      {/* Top Bar */}
      <div className="absolute top-4 left-4 right-4 flex justify-between items-start pointer-events-auto">
         <div className="bg-black/60 p-3 rounded-xl border border-white/10 backdrop-blur-md">
            <h1 
                className={`text-xl font-pusab text-yellow-400 drop-shadow-md tracking-wider ${isEditor ? 'cursor-pointer hover:text-yellow-300 transition-colors' : ''}`}
                onClick={() => {
                    if (isEditor) setShowCredits(true);
                }}
            >
                GEO ARCHITECT
            </h1>
            <div className={`text-xs font-mono mt-1 font-bold ${isEditor ? 'text-green-400' : isPlaytest ? 'text-blue-400' : 'text-purple-400'}`}>
               MODE: {mode}
            </div>
            {!isEditor && <div className="text-[10px] text-gray-400 mt-1">ESC to Stop/Menu</div>}
         </div>

         <div className={`flex gap-2 ${isVerify ? 'opacity-0 hover:opacity-100 transition-opacity duration-300' : ''}`}>
            {isEditor && (
                <button onClick={onOpenSettings} className="p-2 rounded bg-gray-700 hover:bg-gray-600 text-white mr-2" title="Level Settings">
                    <SettingsIcon size={18}/>
                </button>
            )}

            <button onClick={onToggleHitboxes} className={`p-2 rounded hover:bg-gray-600 text-white border border-transparent ${showHitboxes ? 'bg-green-900/50 border-green-500/50' : 'bg-gray-700'}`} title="Toggle Hitboxes">
               {showHitboxes ? <Eye size={18}/> : <EyeOff size={18}/>}
            </button>
            
            {isEditor && (
              <>
                 <div className="flex gap-2 mr-4">
                    <button onClick={onUndo} disabled={!canUndo} className={`bg-gray-700 p-2 rounded hover:bg-gray-600 text-white ${!canUndo ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}`}><Undo size={18}/></button>
                    <button onClick={onRedo} disabled={!canRedo} className={`bg-gray-700 p-2 rounded hover:bg-gray-600 text-white ${!canRedo ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}`}><Redo size={18}/></button>
                 </div>

                 {isPaused ? (
                    <>
                        <button onClick={() => onSetMode(GameMode.PLAYTEST)} className="bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-4 rounded shadow-[0_3px_0_#166534] active:translate-y-0.5 active:shadow-none flex items-center gap-2"><Play size={16} fill="currentColor" /> Resume</button>
                        <button onClick={() => onSetMode(GameMode.EDITOR)} className="bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded shadow-[0_3px_0_#991b1b] active:translate-y-0.5 active:shadow-none flex items-center gap-2"><Square size={16} fill="currentColor" /> Stop</button>
                    </>
                 ) : (
                    <>
                        <button onClick={() => onSetMode(GameMode.PLAYTEST)} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-4 rounded shadow-[0_3px_0_#1e40af] active:translate-y-0.5 active:shadow-none flex items-center gap-2"><Play size={16} fill="currentColor" /> Playtest</button>
                        <button onClick={() => onSetMode(GameMode.VERIFY)} className="bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-4 rounded shadow-[0_3px_0_#166534] active:translate-y-0.5 active:shadow-none flex items-center gap-2"><CheckCircle2 size={16} /> Verify</button>
                    </>
                 )}
              </>
            )}

            {isPlaytest && (
               <>
                   <button onClick={() => onSetMode(GameMode.PAUSED)} className="bg-yellow-600 hover:bg-yellow-500 text-white font-bold py-2 px-4 rounded shadow-[0_3px_0_#854d0e] active:translate-y-0.5 active:shadow-none flex items-center gap-2"><Pause size={16} fill="currentColor" /> Pause</button>
                   <button onClick={() => onSetMode(GameMode.EDITOR)} className="bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded shadow-[0_3px_0_#991b1b] active:translate-y-0.5 active:shadow-none flex items-center gap-2"><Square size={16} fill="currentColor" /> Stop</button>
               </>
            )}
         </div>
      </div>

      {isEditor && (
         <>
            {/* BOTTOM LEFT: Properties & Selection */}
            <div className="absolute bottom-4 left-4 pointer-events-auto flex flex-col gap-2">
                {selectedCount > 0 && (
                   <div className="bg-black/80 p-3 rounded-xl border border-white/20 backdrop-blur-md flex flex-col items-center gap-2 w-64 shadow-xl animate-in slide-in-from-left-10 duration-300">
                      <div className="text-white text-xs font-bold mb-1 flex justify-between w-full px-2">
                         <span>SELECTED: {selectedCount}</span>
                         <button onClick={onDuplicateSelection} className="bg-blue-600 hover:bg-blue-500 text-white p-1 rounded" title="Duplicate">
                             <Copy size={12}/>
                         </button>
                      </div>
                      
                      {selectedStartPosData && onUpdateStartPos && (
                          <div className="w-full bg-gray-900/50 rounded-lg p-2 border border-blue-500/30 mb-1">
                              <label className="text-xs font-bold text-gray-300 mb-2 block border-b border-gray-700 pb-1">START POS SETTINGS</label>
                              <div className="space-y-2">
                                  <div className="flex gap-2">
                                      <button onClick={() => onUpdateStartPos({ mode: VehicleMode.CUBE })} className={`flex-1 py-1 rounded text-[10px] font-bold border ${selectedStartPosData.mode === VehicleMode.CUBE ? 'bg-blue-600 border-blue-400 text-white' : 'bg-gray-800 border-gray-600 text-gray-400'}`}>CUBE</button>
                                      <button onClick={() => onUpdateStartPos({ mode: VehicleMode.SHIP })} className={`flex-1 py-1 rounded text-[10px] font-bold border ${selectedStartPosData.mode === VehicleMode.SHIP ? 'bg-pink-600 border-pink-400 text-white' : 'bg-gray-800 border-gray-600 text-gray-400'}`}>SHIP</button>
                                  </div>
                                  <button onClick={() => onUpdateStartPos({ reverseGravity: !selectedStartPosData.reverseGravity })} className={`w-full py-1 rounded text-[10px] font-bold border flex items-center justify-center gap-1 ${selectedStartPosData.reverseGravity ? 'bg-purple-600 border-purple-400 text-white' : 'bg-gray-800 border-gray-600 text-gray-400'}`}>
                                      {selectedStartPosData.reverseGravity ? <ArrowUp size={12}/> : <ArrowDown size={12}/>} GRAVITY: {selectedStartPosData.reverseGravity ? 'FLIPPED' : 'NORMAL'}
                                  </button>
                                  <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none pt-1 border-t border-gray-700">
                                      <input type="checkbox" checked={selectedStartPosData.enabled} onChange={(e) => onUpdateStartPos({ enabled: e.target.checked })} className="accent-green-500 w-4 h-4 rounded" />
                                      <span className={`font-bold ${selectedStartPosData.enabled ? 'text-green-400' : 'text-gray-500'}`}>ENABLED</span>
                                  </label>
                              </div>
                          </div>
                      )}

                      {selectedTriggerData && onUpdateTrigger && (
                          <div className="w-full bg-gray-900/50 rounded-lg p-2 border border-blue-500/30 mb-1">
                              <div className="grid grid-cols-2 gap-2 mb-2">
                                 <div>
                                     <label className="text-[10px] font-bold text-gray-400 block mb-1">CHANNEL</label>
                                     <select className="w-full bg-gray-800 text-white text-[10px] rounded border border-gray-600 p-1 outline-none" value={selectedTriggerData.target} onChange={(e) => onUpdateTrigger({ target: e.target.value as TriggerTarget })}>
                                         <option value="bgColorTop">BG Top</option>
                                         <option value="bgColorBottom">BG Bot</option>
                                         <option value="groundColor">Ground</option>
                                         <option value="lineColor">Line</option>
                                     </select>
                                 </div>
                                 <div>
                                     <label className="text-[10px] font-bold text-gray-400 block mb-1">FADE TIME</label>
                                     <input type="number" min="0" max="999" step="0.1" value={selectedTriggerData.duration} onChange={(e) => onUpdateTrigger({ duration: parseFloat(e.target.value) || 0 })} className="w-full bg-gray-800 text-white text-[10px] rounded border border-gray-600 p-1 outline-none font-mono" />
                                 </div>
                              </div>
                              <div className="mb-2">
                                 <ColorInput label="TARGET COLOR" value={selectedTriggerData.color} onChange={(c) => onUpdateTrigger({ color: c })} onReset={() => onUpdateTrigger({ color: DEFAULT_LEVEL_SETTINGS[selectedTriggerData.target] })} />
                              </div>
                              <div className="flex items-center gap-2">
                                  <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
                                      <input type="checkbox" checked={selectedTriggerData.touchTrigger || false} onChange={(e) => onUpdateTrigger({ touchTrigger: e.target.checked })} className="accent-blue-500 w-4 h-4 rounded" />
                                      <span className="font-bold flex items-center gap-1"><Hand size={12}/> Touch Trigger</span>
                                  </label>
                              </div>
                          </div>
                      )}
                      
                      {!selectedStartPosData && !selectedTriggerData && (
                          <>
                              <div className="grid grid-cols-2 gap-2 w-full mt-1">
                                  <button onClick={() => onRotateSelection(-90, true)} className="bg-gray-700 text-white text-xs py-1.5 rounded hover:bg-gray-600 flex items-center justify-center gap-1"><RotateCcw size={12}/> -90°</button>
                                  <button onClick={() => onRotateSelection(90, true)} className="bg-gray-700 text-white text-xs py-1.5 rounded hover:bg-gray-600 flex items-center justify-center gap-1"><RotateCw size={12}/> +90°</button>
                              </div>
                              {!hasBlockSelected && (
                                  <div className="w-full mt-1 px-1">
                                      <label className="text-[10px] text-gray-400 font-bold mb-1 block">FREE ROTATION</label>
                                      <input type="range" min="0" max="360" step="15" defaultValue="0" className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500" onChange={(e) => onRotateSelection(parseInt(e.target.value), false)} />
                                  </div>
                              )}
                          </>
                      )}

                      <div className="w-full h-[1px] bg-white/10 my-1"></div>

                      <div className="grid grid-cols-4 gap-2 w-full mt-1">
                         <button onClick={() => onMoveSelection(0, -1)} className="bg-gray-700 text-white p-2 rounded hover:bg-gray-600 flex justify-center"><ArrowUp size={16}/></button>
                         <button onClick={() => onMoveSelection(0, 1)} className="bg-gray-700 text-white p-2 rounded hover:bg-gray-600 flex justify-center"><ArrowDown size={16}/></button>
                         <button onClick={() => onMoveSelection(-1, 0)} className="bg-gray-700 text-white p-2 rounded hover:bg-gray-600 flex justify-center"><ArrowLeft size={16}/></button>
                         <button onClick={() => onMoveSelection(1, 0)} className="bg-gray-700 text-white p-2 rounded hover:bg-gray-600 flex justify-center"><ArrowRight size={16}/></button>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 w-full mt-2">
                          <div className="grid grid-cols-2 gap-1">
                              <button onClick={() => onMoveSelection(-5, 0)} className="bg-gray-800 text-white text-[9px] py-1 rounded border border-gray-600 hover:bg-gray-700">Big L</button>
                              <button onClick={() => onMoveSelection(5, 0)} className="bg-gray-800 text-white text-[9px] py-1 rounded border border-gray-600 hover:bg-gray-700">Big R</button>
                              <button onClick={() => onMoveSelection(0, -5)} className="bg-gray-800 text-white text-[9px] py-1 rounded border border-gray-600 hover:bg-gray-700">Big U</button>
                              <button onClick={() => onMoveSelection(0, 5)} className="bg-gray-800 text-white text-[9px] py-1 rounded border border-gray-600 hover:bg-gray-700">Big D</button>
                          </div>
                          <div className="grid grid-cols-2 gap-1">
                              <button onClick={() => onMoveSelection(-0.5, 0)} className="bg-gray-800 text-white text-[9px] py-1 rounded border border-gray-600 hover:bg-gray-700">Small L</button>
                              <button onClick={() => onMoveSelection(0.5, 0)} className="bg-gray-800 text-white text-[9px] py-1 rounded border border-gray-600 hover:bg-gray-700">Small R</button>
                              <button onClick={() => onMoveSelection(0, -0.5)} className="bg-gray-800 text-white text-[9px] py-1 rounded border border-gray-600 hover:bg-gray-700">Small U</button>
                              <button onClick={() => onMoveSelection(0, 0.5)} className="bg-gray-800 text-white text-[9px] py-1 rounded border border-gray-600 hover:bg-gray-700">Small D</button>
                          </div>
                      </div>
                      <div className="grid grid-cols-4 gap-1 w-full mt-1">
                          <button onClick={() => onMoveSelection(-0.1, 0)} className="bg-gray-800 text-white text-[9px] py-1 rounded border border-gray-600 hover:bg-gray-700">Tiny L</button>
                          <button onClick={() => onMoveSelection(0.1, 0)} className="bg-gray-800 text-white text-[9px] py-1 rounded border border-gray-600 hover:bg-gray-700">Tiny R</button>
                          <button onClick={() => onMoveSelection(0, -0.1)} className="bg-gray-800 text-white text-[9px] py-1 rounded border border-gray-600 hover:bg-gray-700">Tiny U</button>
                          <button onClick={() => onMoveSelection(0, 0.1)} className="bg-gray-800 text-white text-[9px] py-1 rounded border border-gray-600 hover:bg-gray-700">Tiny D</button>
                      </div>

                      <button onClick={onDeselect} className="w-full bg-gray-700 hover:bg-gray-600 text-white text-xs py-2 mt-2 rounded flex justify-center gap-1 font-bold border border-gray-600">
                         <XCircle size={14}/> Deselect
                      </button>

                      <button onClick={onDeleteSelection} className="w-full bg-red-900/80 hover:bg-red-800 text-red-200 text-xs py-2 mt-2 rounded flex justify-center gap-1 font-bold border border-red-700">
                         <Trash2 size={14}/> Delete
                      </button>
                   </div>
                )}
            </div>

            {/* BOTTOM CENTER: Toolbar */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-auto flex flex-col items-center">
               <div className="flex gap-1 ml-2 self-start">
                  <button onClick={() => setTab('blocks')} className={`px-4 py-1.5 rounded-t-lg text-sm font-bold transition-colors ${tab==='blocks' ? 'bg-black/80 text-white border-t border-x border-white/20' : 'bg-black/40 text-gray-400 hover:bg-black/60'}`}>Blocks</button>
                  <button onClick={() => setTab('hazards')} className={`px-4 py-1.5 rounded-t-lg text-sm font-bold transition-colors ${tab==='hazards' ? 'bg-black/80 text-white border-t border-x border-white/20' : 'bg-black/40 text-gray-400 hover:bg-black/60'}`}>Hazards</button>
                  <button onClick={() => setTab('special')} className={`px-4 py-1.5 rounded-t-lg text-sm font-bold transition-colors ${tab==='special' ? 'bg-black/80 text-white border-t border-x border-white/20' : 'bg-black/40 text-gray-400 hover:bg-black/60'}`}>Special</button>
                  <button onClick={() => setTab('deco')} className={`px-4 py-1.5 rounded-t-lg text-sm font-bold transition-colors ${tab==='deco' ? 'bg-black/80 text-white border-t border-x border-white/20' : 'bg-black/40 text-gray-400 hover:bg-black/60'}`}>Deco</button>
                  <button onClick={() => setTab('triggers')} className={`px-4 py-1.5 rounded-t-lg text-sm font-bold transition-colors ${tab==='triggers' ? 'bg-black/80 text-white border-t border-x border-white/20' : 'bg-black/40 text-gray-400 hover:bg-black/60'}`}>Triggers</button>
                  <button onClick={() => setTab('tools')} className={`px-4 py-1.5 rounded-t-lg text-sm font-bold transition-colors ${tab==='tools' ? 'bg-black/80 text-white border-t border-x border-white/20' : 'bg-black/40 text-gray-400 hover:bg-black/60'}`}>Tools</button>
               </div>

               <div className="bg-black/80 p-4 rounded-xl border border-white/20 backdrop-blur-md flex flex-col gap-2 shadow-xl min-w-[300px]">
                  {tab === 'special' && (
                      <div className="flex items-center justify-between w-full mb-2 bg-white/5 rounded p-1">
                          <button onClick={() => cycleSpecialPage(-1)} className="p-1 text-gray-400 hover:text-white"><ChevronLeft size={20}/></button>
                          <span className="font-pusab text-xs text-yellow-400">{SPECIAL_TITLES[specialPage]}</span>
                          <button onClick={() => cycleSpecialPage(1)} className="p-1 text-gray-400 hover:text-white"><ChevronRight size={20}/></button>
                      </div>
                  )}
                  
                  <div className="flex gap-4 justify-center">
                      {tab === 'blocks' && (
                         <>
                            <ToolBtn active={isToolActive(ObjectType.BLOCK, 1)} onClick={() => onSelectTool(ObjectType.BLOCK, 1)}>
                               <div className="w-full h-full bg-[rgba(0,0,0,0.5)] border-2 border-[#00ffff] relative">
                                   <div className="absolute inset-[6px] border-2 border-[#00ffff]"></div>
                               </div>
                            </ToolBtn>
                            <ToolBtn active={isToolActive(ObjectType.BLOCK, 2)} onClick={() => onSelectTool(ObjectType.BLOCK, 2)}>
                               <svg viewBox="0 0 40 40" className="w-full h-full bg-[#b7410e] border border-white">
                                   <line x1="0" y1="10" x2="40" y2="10" stroke="white" strokeWidth="1"/>
                                   <line x1="0" y1="20" x2="40" y2="20" stroke="white" strokeWidth="1"/>
                                   <line x1="0" y1="30" x2="40" y2="30" stroke="white" strokeWidth="1"/>
                                   <line x1="20" y1="0" x2="20" y2="10" stroke="white" strokeWidth="1"/>
                                   <line x1="10" y1="10" x2="10" y2="20" stroke="white" strokeWidth="1"/>
                                   <line x1="30" y1="10" x2="30" y2="20" stroke="white" strokeWidth="1"/>
                                   <line x1="20" y1="20" x2="20" y2="30" stroke="white" strokeWidth="1"/>
                                   <line x1="10" y1="30" x2="10" y2="40" stroke="white" strokeWidth="1"/>
                                   <line x1="30" y1="30" x2="30" y2="40" stroke="white" strokeWidth="1"/>
                               </svg>
                            </ToolBtn>
                            <ToolBtn active={isToolActive(ObjectType.BLOCK, 3)} onClick={() => onSelectTool(ObjectType.BLOCK, 3)}>
                               <div className="w-full h-full relative flex flex-col justify-start">
                                    <div className="w-full h-[50%] bg-[rgba(0,0,0,0.5)] border-2 border-[#00ffff] box-border relative">
                                        <div className="absolute inset-[4px] border-2 border-[#00ffff]"></div>
                                    </div>
                               </div>
                            </ToolBtn>
                         </>
                      )}
                      {tab === 'hazards' && (
                          <>
                            <ToolBtn active={isToolActive(ObjectType.SPIKE, 1)} onClick={() => onSelectTool(ObjectType.SPIKE, 1)}>
                                <svg viewBox="0 0 40 40" className="w-full h-full p-1 drop-shadow-sm"><path d="M20 5 L35 35 L5 35 Z" fill="#222" stroke="#ddd" strokeWidth="2"/></svg>
                            </ToolBtn>
                            <ToolBtn active={isToolActive(ObjectType.SPIKE, 2)} onClick={() => onSelectTool(ObjectType.SPIKE, 2)}>
                                <svg viewBox="0 0 40 40" className="w-full h-full p-2"><path d="M20 5 L35 35 L5 35 Z" fill="#222" stroke="#ddd" strokeWidth="2"/></svg>
                            </ToolBtn>
                            <ToolBtn active={isToolActive(ObjectType.SPIKE, 3)} onClick={() => onSelectTool(ObjectType.SPIKE, 3)}>
                                <svg viewBox="0 0 40 40" className="w-full h-full p-1">
                                    <path d="M2,40 L20,25 L38,40 Z" fill="#222" stroke="#ddd" strokeWidth="2"/>
                                </svg>
                            </ToolBtn>
                          </>
                      )}
                      {tab === 'special' && (
                          <>
                            {specialPage === 0 && ( // PADS
                                <>
                                    <ToolBtn active={isToolActive(ObjectType.PAD, 1)} onClick={() => onSelectTool(ObjectType.PAD, 1)}>
                                        <svg viewBox="0 0 40 40" className="w-full h-full">
                                            <path d="M 5 40 Q 20 30 35 40 Z" fill="rgba(255,102,204,0.3)" stroke="#ff66cc" strokeWidth="3"/>
                                            <circle cx="20" cy="35" r="4" fill="#ff66cc"/>
                                        </svg>
                                    </ToolBtn>
                                    <ToolBtn active={isToolActive(ObjectType.PAD, 2)} onClick={() => onSelectTool(ObjectType.PAD, 2)}>
                                        <svg viewBox="0 0 40 40" className="w-full h-full">
                                            <path d="M 5 40 Q 20 25 35 40 Z" fill="rgba(255,255,0,0.3)" stroke="#ffff00" strokeWidth="3"/>
                                            <circle cx="20" cy="32" r="5" fill="#ffff00"/>
                                        </svg>
                                    </ToolBtn>
                                    <ToolBtn active={isToolActive(ObjectType.PAD, 3)} onClick={() => onSelectTool(ObjectType.PAD, 3)}>
                                        <svg viewBox="0 0 40 40" className="w-full h-full">
                                            <path d="M 5 40 Q 20 20 35 40 Z" fill="rgba(255,0,0,0.3)" stroke="#ff0000" strokeWidth="3"/>
                                            <circle cx="20" cy="30" r="6" fill="#ff0000"/>
                                        </svg>
                                    </ToolBtn>
                                    <ToolBtn active={isToolActive(ObjectType.PAD, 4)} onClick={() => onSelectTool(ObjectType.PAD, 4)}>
                                        <svg viewBox="0 0 40 40" className="w-full h-full">
                                            <path d="M 5 40 Q 20 20 35 40 Z" fill="rgba(0,255,255,0.3)" stroke="#00ffff" strokeWidth="3"/>
                                            <circle cx="20" cy="30" r="6" fill="#00ffff"/>
                                        </svg>
                                    </ToolBtn>
                                </>
                            )}
                            {specialPage === 1 && ( // ORBS
                                <>
                                    <ToolBtn active={isToolActive(ObjectType.ORB, 1)} onClick={() => onSelectTool(ObjectType.ORB, 1)}>
                                        <div className="w-full h-full flex items-center justify-center">
                                            <div className="w-[16px] h-[16px] rounded-full bg-[#ff66cc] border-[2px] border-[#ff66cc] ring-2 ring-inset ring-[rgba(255,255,255,0.5)] shadow-[0_0_8px_#ff66cc]"></div>
                                        </div>
                                    </ToolBtn>
                                    <ToolBtn active={isToolActive(ObjectType.ORB, 2)} onClick={() => onSelectTool(ObjectType.ORB, 2)}>
                                        <div className="w-full h-full flex items-center justify-center">
                                            <div className="w-[20px] h-[20px] rounded-full bg-[#ffff00] border-[2px] border-[#ffff00] ring-2 ring-inset ring-[rgba(255,255,255,0.5)] shadow-[0_0_8px_#ffff00]"></div>
                                        </div>
                                    </ToolBtn>
                                    <ToolBtn active={isToolActive(ObjectType.ORB, 3)} onClick={() => onSelectTool(ObjectType.ORB, 3)}>
                                        <div className="w-full h-full flex items-center justify-center">
                                            <div className="w-[24px] h-[24px] rounded-full bg-[#ff0000] border-[2px] border-[#ff0000] ring-2 ring-inset ring-[rgba(255,255,255,0.5)] shadow-[0_0_8px_#ff0000]"></div>
                                        </div>
                                    </ToolBtn>
                                    <ToolBtn active={isToolActive(ObjectType.ORB, 4)} onClick={() => onSelectTool(ObjectType.ORB, 4)}>
                                        <div className="w-full h-full flex items-center justify-center">
                                            <div className="w-[24px] h-[24px] rounded-full bg-[#00ffff] border-[2px] border-[#00ffff] ring-2 ring-inset ring-[rgba(255,255,255,0.5)] shadow-[0_0_8px_#00ffff]"></div>
                                        </div>
                                    </ToolBtn>
                                </>
                            )}
                            {specialPage === 2 && ( // GAMEMODES
                                <>
                                    <ToolBtn active={isToolActive(ObjectType.PORTAL, 1)} onClick={() => onSelectTool(ObjectType.PORTAL, 1)}>
                                        <svg viewBox="0 0 40 40" className="w-full h-full">
                                            <path d="M 12 5 L 28 5 L 28 15 L 25 20 L 28 25 L 28 35 L 12 35 L 12 25 L 15 20 L 12 15 Z" fill="rgba(0,255,0,0.6)" stroke="white" strokeWidth="2"/>
                                            <ellipse cx="20" cy="20" rx="2" ry="12" fill="white"/>
                                        </svg>
                                    </ToolBtn>
                                    <ToolBtn active={isToolActive(ObjectType.PORTAL, 2)} onClick={() => onSelectTool(ObjectType.PORTAL, 2)}>
                                        <svg viewBox="0 0 40 40" className="w-full h-full">
                                            <path d="M 12 5 L 28 5 L 28 15 L 25 20 L 28 25 L 28 35 L 12 35 L 12 25 L 15 20 L 12 15 Z" fill="rgba(255,102,204,0.6)" stroke="white" strokeWidth="2"/>
                                            <ellipse cx="20" cy="20" rx="2" ry="12" fill="white"/>
                                        </svg>
                                    </ToolBtn>
                                </>
                            )}
                            {specialPage === 3 && ( // GRAVITY
                                <>
                                     <ToolBtn active={isToolActive(ObjectType.PORTAL, 3)} onClick={() => onSelectTool(ObjectType.PORTAL, 3)}>
                                         <svg viewBox="0 0 40 40" className="w-full h-full">
                                             <path d="M 10 5 L 30 5 C 30 15 24 18 24 20 C 24 22 30 25 30 35 L 10 35 C 10 25 16 22 16 20 C 16 18 10 15 10 5 Z" fill="rgba(255,255,0,0.6)" stroke="white" strokeWidth="2"/>
                                             <path d="M 20 12 L 25 22 L 15 22 Z" fill="white"/>
                                             <path d="M 18 22 L 22 22 L 22 28 L 18 28 Z" fill="white"/>
                                         </svg>
                                     </ToolBtn>
                                     <ToolBtn active={isToolActive(ObjectType.PORTAL, 4)} onClick={() => onSelectTool(ObjectType.PORTAL, 4)}>
                                         <svg viewBox="0 0 40 40" className="w-full h-full">
                                             <path d="M 10 5 L 30 5 C 30 15 24 18 24 20 C 24 22 30 25 30 35 L 10 35 C 10 25 16 22 16 20 C 16 18 10 15 10 5 Z" fill="rgba(0,255,255,0.6)" stroke="white" strokeWidth="2"/>
                                             <path d="M 20 28 L 25 18 L 15 18 Z" fill="white"/>
                                             <path d="M 18 18 L 22 18 L 22 12 L 18 12 Z" fill="white"/>
                                         </svg>
                                     </ToolBtn>
                                     <ToolBtn active={isToolActive(ObjectType.PORTAL, 5)} onClick={() => onSelectTool(ObjectType.PORTAL, 5)}>
                                         <svg viewBox="0 0 40 40" className="w-full h-full">
                                             <path d="M 10 5 L 30 5 C 30 15 24 18 24 20 C 24 22 30 25 30 35 L 10 35 C 10 25 16 22 16 20 C 16 18 10 15 10 5 Z" fill="rgba(0,255,0,0.6)" stroke="white" strokeWidth="2"/>
                                             <path d="M 20 12 L 25 20 L 20 28 L 15 20 Z" fill="white"/>
                                         </svg>
                                     </ToolBtn>
                                </>
                            )}
                          </>
                      )}
                      {tab === 'deco' && (
                          <>
                             <ToolBtn active={isToolActive(ObjectType.DECO, 1)} onClick={() => onSelectTool(ObjectType.DECO, 1)}>
                                 <div className="w-full h-full flex items-center justify-center">
                                     <svg viewBox="0 0 40 40" className="w-full h-full text-white/70">
                                        <circle cx="15" cy="25" r="10" fill="currentColor"/>
                                        <circle cx="25" cy="20" r="12" fill="currentColor"/>
                                        <circle cx="35" cy="25" r="8" fill="currentColor"/>
                                        <rect x="15" y="25" width="20" height="10" fill="currentColor"/>
                                     </svg>
                                 </div>
                             </ToolBtn>
                             <ToolBtn active={isToolActive(ObjectType.DECO, 2)} onClick={() => onSelectTool(ObjectType.DECO, 2)}>
                                 <svg viewBox="0 0 40 40" className="w-full h-full">
                                    <circle cx="12" cy="30" r="10" fill="#118833"/>
                                    <circle cx="28" cy="30" r="10" fill="#118833"/>
                                    <circle cx="20" cy="22" r="12" fill="#22cc55"/>
                                    <circle cx="20" cy="18" r="5" fill="#55ee77"/>
                                 </svg>
                             </ToolBtn>
                             <ToolBtn active={isToolActive(ObjectType.DECO, 3)} onClick={() => onSelectTool(ObjectType.DECO, 3)}>
                                 <svg viewBox="0 0 40 40" className="w-full h-full">
                                    <ellipse cx="20" cy="10" rx="5" ry="8" stroke="#888" strokeWidth="3" fill="none"/>
                                    <line x1="20" y1="18" x2="20" y2="22" stroke="#888" strokeWidth="3"/>
                                    <ellipse cx="20" cy="30" rx="5" ry="8" stroke="#888" strokeWidth="3" fill="none"/>
                                 </svg>
                             </ToolBtn>
                          </>
                      )}
                      {tab === 'triggers' && (
                          <>
                              <ToolBtn active={isToolActive(ObjectType.TRIGGER, 1)} onClick={() => onSelectTool(ObjectType.TRIGGER, 1)}>
                                 <div className="flex flex-col items-center justify-center w-full h-full relative">
                                     <div className="absolute inset-2 border border-white rounded-full"></div>
                                     <span className="text-[10px] font-bold text-white z-10">Col</span>
                                     <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full">
                                         <div className="absolute top-[8px] right-[8px] w-1.5 h-1.5 bg-red-500 rounded-full"></div>
                                         <div className="absolute bottom-[8px] right-[8px] w-1.5 h-1.5 bg-green-500 rounded-full"></div>
                                         <div className="absolute top-[8px] left-[8px] w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
                                     </div>
                                 </div>
                              </ToolBtn>
                              <ToolBtn active={isToolActive(ObjectType.START_POS, 1)} onClick={() => onSelectTool(ObjectType.START_POS, 1)}>
                                 <div className="flex flex-col items-center justify-center w-full h-full relative">
                                     <div className="w-6 h-6 border-2 border-cyan-400 rotate-45 bg-blue-900/50"></div>
                                     <span className="text-[8px] font-bold text-white z-10 absolute">POS</span>
                                 </div>
                              </ToolBtn>
                          </>
                      )}
                      {tab === 'tools' && (
                          <>
                            <ToolBtn active={isToolActive(ObjectType.TOOL, 0)} onClick={() => onSelectTool(ObjectType.TOOL, 0)}>
                               <MousePointer2 className="text-green-400" size={24} />
                            </ToolBtn>
                            <ToolBtn active={isToolActive(ObjectType.DELETE, 0)} onClick={() => onSelectTool(ObjectType.DELETE, 0)}>
                               <Trash2 className="text-red-500" size={24} />
                            </ToolBtn>
                          </>
                      )}
                  </div>
               </div>
            </div>
         </>
      )}
    </div>
  );
};

export default UIOverlay;
