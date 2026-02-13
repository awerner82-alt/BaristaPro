
import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

// --- TYPES ---
interface EspressoShot {
  id: string;
  timestamp: number;
  beanName: string;
  roastDate?: string;
  dose: number;
  yield: number;
  time: number;
  temperature?: number;
  maraXTempSetting: '0' | 'I' | 'II';
  grindSetting: string;
  notes: string;
  flavorProfile: {
    sourness: number;
    bitterness: number;
    body: number;
    sweetness: number;
    overall: number;
  };
}

interface DialInAdvice {
  diagnosis: string;
  recommendation: string;
  adjustment: string;
  explanation: string;
}

interface CoffeeSearchRecommendation {
  found: boolean;
  dose?: number;
  yield?: number;
  time?: number;
  temperature?: string;
  maraXSetting?: '0' | 'I' | 'II';
  description?: string;
  sources: { title: string; uri: string }[];
}

// Globaler Zugriff auf Process für den API Key Shim
declare global {
  interface Window {
    process: { env: { API_KEY: string } };
  }
}

// --- SERVICES ---
const getApiKey = () => {
  // Versuche Key aus window.process (Shim) oder localStorage zu holen
  return window.process?.env?.API_KEY || localStorage.getItem('GEMINI_API_KEY') || '';
};

const searchCoffeeParameters = async (query: string): Promise<CoffeeSearchRecommendation> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key vorhanden");

  const ai = new GoogleGenAI({ apiKey });
  
  const prompt = `Suche nach Brühparametern (Brew Guide) für diesen Kaffee: "${query}". 
  Priorisiere Quellen von Röstern oder Foren wie Kaffee-Netz/Home-Barista.
  Antworte ausschließlich in folgendem JSON-Format:
  {
    "found": boolean,
    "dose": number,
    "yield": number,
    "time": number,
    "temperature": "string",
    "maraXSetting": "0" | "I" | "II",
    "description": "Kurze Zusammenfassung auf Deutsch"
  }
  Falls es eine Lelit Mara X spezifische Empfehlung gibt, nenne die PID-Stufe (0, I, II). Wenn nichts gefunden wird, setze 'found' auf false.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        systemInstruction: "Du bist ein Barista-Experte. Antworte immer mit validem JSON. Ignoriere Markdown Formatierung im Output.",
      },
    });

    const text = response.text || "";
    const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((chunk: any) => ({
        title: chunk.web?.title || "Quelle",
        uri: chunk.web?.uri || ""
      }))
      .filter((s: any) => s.uri) || [];

    // Robustere JSON Extraktion (entfernt Markdown Code Blocks ```json ... ```)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        console.warn("Kein JSON im Response gefunden:", text);
        return { found: false, sources, description: "Konnte Antwort nicht lesen." };
    }

    try {
        const jsonData = JSON.parse(jsonMatch[0]);
        return { ...jsonData, sources };
    } catch (e) {
        console.error("JSON Parse Error:", e);
        return { found: false, sources, description: "Fehler beim Verarbeiten der Daten." };
    }

  } catch (e) {
    console.error("Search API Error:", e);
    return { found: false, sources: [], description: "API Fehler: " + (e as Error).message };
  }
};

const getBaristaAdvice = async (shot: EspressoShot): Promise<DialInAdvice> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key vorhanden");

  const ai = new GoogleGenAI({ apiKey });
  
  const prompt = `
    Analysiere diesen Espresso-Shot basierend auf folgendem Setup:
    Maschine: Lelit Mara X (E61 Gruppe, PID-Stufe: ${shot.maraXTempSetting})
    Mühle: Varia VS3 (Single Dosing, stufenlos)
    
    Shot-Daten:
    Bohne: ${shot.beanName}
    Dosis (In): ${shot.dose}g
    Ertrag (Out): ${shot.yield}g
    Zeit: ${shot.time}s
    Eingestellter Mahlgrad: ${shot.grindSetting}
    
    Geschmacksprofil (1-5):
    Säure: ${shot.flavorProfile.sourness}
    Bitterkeit: ${shot.flavorProfile.bitterness}
    Körper: ${shot.flavorProfile.body}
    Süße: ${shot.flavorProfile.sweetness}
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: "Du bist ein Barista-Experte für Lelit Mara X und Varia VS3. Gib prägnante, deutsche Tipps im JSON-Format.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            diagnosis: { type: Type.STRING },
            recommendation: { type: Type.STRING },
            adjustment: { type: Type.STRING },
            explanation: { type: Type.STRING }
          },
          required: ["diagnosis", "recommendation", "adjustment", "explanation"]
        }
      }
    });

    return JSON.parse(response.text.trim()) as DialInAdvice;
  } catch (error) {
    console.error("Advice API Error:", error);
    return {
      diagnosis: "Analyse momentan nicht möglich.",
      recommendation: "Mahlgrad nach Gefühl anpassen.",
      adjustment: "Leicht feiner/gröber probieren.",
      explanation: "Keine Verbindung zum Barista-Server."
    };
  }
};

// --- COMPONENTS ---

// ShotTimer
type TimerState = 'IDLE' | 'PUMPING' | 'EXTRACTING';

const ShotTimer: React.FC<{ onStop: (seconds: number) => void }> = ({ onStop }) => {
  const [state, setState] = useState<TimerState>('IDLE');
  const [time, setTime] = useState(0);
  const [pumpTime, setPumpTime] = useState(0);
  const timerRef = useRef<number | null>(null);
  const pumpTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (state === 'EXTRACTING') {
      const startTime = Date.now() - time * 1000;
      timerRef.current = window.setInterval(() => {
        setTime(Math.floor((Date.now() - startTime) / 1000));
      }, 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    if (state === 'PUMPING') {
      const startPumpTime = Date.now() - pumpTime * 1000;
      pumpTimerRef.current = window.setInterval(() => {
        setPumpTime(Math.floor((Date.now() - startPumpTime) / 1000));
      }, 100);
    } else {
      if (pumpTimerRef.current) clearInterval(pumpTimerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (pumpTimerRef.current) clearInterval(pumpTimerRef.current);
    };
  }, [state]);

  const handleStartPump = () => {
    setState('PUMPING');
    setTime(0);
    setPumpTime(0);
  };

  const handleFirstDrop = () => {
    setState('EXTRACTING');
  };

  const handleStop = () => {
    onStop(time);
    setState('IDLE');
  };

  const handleReset = () => {
    setState('IDLE');
    setTime(0);
    setPumpTime(0);
  };

  return (
    <div className="bg-black/40 border border-white/5 rounded-3xl p-6 flex flex-col items-center gap-4 w-full">
      <div className="flex flex-col items-center gap-1">
        <span className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">Extraktionszeit</span>
        <div className="text-5xl font-mono font-bold text-amber-500 tabular-nums">
          {time}<span className="text-xl text-slate-600 ml-1">s</span>
        </div>
        {state === 'PUMPING' && (
          <div className="text-xs text-emerald-500 font-bold animate-pulse mt-2">
            Warte auf ersten Tropfen... ({pumpTime}s)
          </div>
        )}
      </div>

      <div className="flex gap-3 w-full">
        {state === 'IDLE' && (
          <button
            onClick={handleStartPump}
            type="button"
            className="flex-1 bg-amber-500 text-black font-bold py-4 rounded-2xl active:scale-95 transition-all text-sm"
          >
            Pumpe Start
          </button>
        )}
        
        {state === 'PUMPING' && (
          <button
            onClick={handleFirstDrop}
            type="button"
            className="flex-1 bg-emerald-500 text-black font-bold py-4 rounded-2xl active:scale-95 transition-all text-sm animate-bounce"
          >
            Erster Tropfen!
          </button>
        )}

        {state === 'EXTRACTING' && (
          <button
            onClick={handleStop}
            type="button"
            className="flex-1 bg-red-500 text-white font-bold py-4 rounded-2xl active:scale-95 transition-all text-sm"
          >
            Stop
          </button>
        )}

        {state !== 'IDLE' && (
          <button
            onClick={handleReset}
            type="button"
            className="px-6 bg-white/5 text-slate-400 font-bold py-4 rounded-2xl active:scale-95 transition-all text-sm border border-white/5"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
};

// ShotCard
const ShotCard: React.FC<{ shot: EspressoShot; onDelete?: (id: string) => void }> = ({ shot, onDelete }) => {
  const ratio = (shot.yield / shot.dose).toFixed(1);
  const date = new Date(shot.timestamp).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' });

  return (
    <div className="bg-[#111] border border-white/5 p-5 rounded-[1.5rem] hover:bg-[#161616] transition-all relative overflow-hidden active:bg-black group">
      <div className="flex justify-between items-start mb-4">
        <div className="max-w-[80%]">
          <h3 className="text-base font-bold text-white truncate leading-tight mb-1">{shot.beanName}</h3>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">{date}</span>
            <span className="w-1 h-1 bg-slate-700 rounded-full"></span>
            <span className="text-[9px] text-amber-500/80 font-bold uppercase tracking-widest">PID {shot.maraXTempSetting}</span>
          </div>
        </div>
        {onDelete && (
          <button 
            onClick={(e) => { e.stopPropagation(); onDelete(shot.id); }}
            className="text-slate-700 hover:text-red-500/50 transition-colors p-2 -mr-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>
      
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-black/40 rounded-xl p-3 text-center border border-white/5">
          <p className="text-[8px] text-slate-600 uppercase font-bold mb-1 tracking-tighter">In / Out</p>
          <p className="text-xs font-mono text-slate-200">{shot.dose} / {shot.yield}g</p>
        </div>
        <div className="bg-black/40 rounded-xl p-3 text-center border border-white/5">
          <p className="text-[8px] text-slate-600 uppercase font-bold mb-1 tracking-tighter">Zeit</p>
          <p className="text-xs font-mono text-slate-200">{shot.time}s</p>
        </div>
        <div className="bg-black/40 rounded-xl p-3 text-center border border-white/5">
          <p className="text-[8px] text-slate-600 uppercase font-bold mb-1 tracking-tighter">Mahlgrad</p>
          <p className="text-xs font-mono text-amber-500/80">{shot.grindSetting || 'n.a.'}</p>
        </div>
      </div>

      <div className="flex gap-1.5 h-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div 
            key={i} 
            className={`flex-1 rounded-full ${i < shot.flavorProfile.overall ? 'bg-amber-500/60' : 'bg-white/5'}`} 
          />
        ))}
      </div>
    </div>
  );
};

// --- APP COMPONENT ---
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }
  interface Window {
    aistudio?: AIStudio;
  }
}

const App: React.FC = () => {
  const [shots, setShots] = useState<EspressoShot[]>([]);
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [advice, setAdvice] = useState<DialInAdvice | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Neuer State für den API Key
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('GEMINI_API_KEY') || '');
  const [showKeyInput, setShowKeyInput] = useState(false);
  
  const [isAdding, setIsAdding] = useState(false);
  const [searchStep, setSearchStep] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchRecommendation, setSearchRecommendation] = useState<CoffeeSearchRecommendation | null>(null);

  const [form, setForm] = useState<Partial<EspressoShot>>({
    beanName: '',
    dose: 18,
    yield: 36,
    time: 25,
    maraXTempSetting: '0',
    grindSetting: '',
    notes: '',
    flavorProfile: { sourness: 3, bitterness: 3, body: 3, sweetness: 3, overall: 3 }
  });

  // Sync API Key to Shim
  useEffect(() => {
    if (apiKey && window.process && window.process.env) {
      window.process.env.API_KEY = apiKey;
    }
  }, [apiKey]);

  // Check if we need to show key input (only if no window.aistudio and no local key)
  useEffect(() => {
    const checkKey = async () => {
      let hasKey = !!apiKey;
      if (!hasKey && window.aistudio) {
        hasKey = await window.aistudio.hasSelectedApiKey();
      }
      
      if (!hasKey) {
        setShowKeyInput(true);
      }
    };
    checkKey();
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('barista_shots_v3');
    if (saved) setShots(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem('barista_shots_v3', JSON.stringify(shots));
  }, [shots]);

  const saveApiKey = (key: string) => {
    localStorage.setItem('GEMINI_API_KEY', key);
    setApiKey(key);
    setShowKeyInput(false);
  };

  const handleStartSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery) return;
    
    setError(null);
    setIsSearching(true);

    try {
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
          await window.aistudio.openSelectKey();
        }
      } else if (!apiKey) {
        setShowKeyInput(true);
        setIsSearching(false);
        return;
      }

      const rec = await searchCoffeeParameters(searchQuery);
      if (!rec.found && rec.sources.length === 0) {
        setError(rec.description || "Suche war nicht erfolgreich.");
      }
      setSearchRecommendation(rec);
    } catch (err: any) {
      setError("Verbindung fehlgeschlagen. Prüfe deinen API Key.");
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  const applyRecommendation = () => {
    if (searchRecommendation) {
      setForm(prev => ({
        ...prev,
        beanName: searchQuery,
        dose: searchRecommendation.dose || prev.dose,
        yield: searchRecommendation.yield || prev.yield,
        time: searchRecommendation.time || prev.time,
        maraXTempSetting: searchRecommendation.maraXSetting || prev.maraXTempSetting,
      }));
    } else {
      setForm(prev => ({ ...prev, beanName: searchQuery }));
    }
    setSearchStep(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newShot: EspressoShot = {
      ...form as EspressoShot,
      id: Date.now().toString(),
      timestamp: Date.now(),
      flavorProfile: { ...form.flavorProfile! }
    };
    setShots([newShot, ...shots]);
    setIsAdding(false);
    
    setLoadingAdvice(true);
    try {
      const aiAdvice = await getBaristaAdvice(newShot);
      setAdvice(aiAdvice);
    } catch (err) {
      setError("Analyse-Fehler. Prüfe deinen API Key.");
    } finally {
      setLoadingAdvice(false);
    }
  };

  const repeatShot = () => {
    setSearchStep(false);
    setIsAdding(true);
    setAdvice(null);
    setError(null);
  };

  const startNewCoffee = () => {
    setSearchQuery('');
    setSearchRecommendation(null);
    setSearchStep(true);
    setIsAdding(true);
    setAdvice(null);
    setError(null);
  };

  const updateFlavor = (key: keyof EspressoShot['flavorProfile'], val: number) => {
    setForm(prev => ({
      ...prev,
      flavorProfile: { ...prev.flavorProfile!, [key]: val }
    }));
  };

  if (showKeyInput) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <div className="bg-[#111] p-8 rounded-[2rem] border border-amber-500/20 max-w-md w-full shadow-2xl">
          <div className="w-16 h-16 bg-amber-500/10 rounded-2xl flex items-center justify-center mb-6 mx-auto">
             <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
          </div>
          <h2 className="text-2xl font-bold text-white text-center mb-2 font-serif">Setup Required</h2>
          <p className="text-slate-500 text-center text-sm mb-8">Gib deinen Google Gemini API Key ein, um den Barista Coach zu nutzen. Der Key wird nur lokal in deinem Browser gespeichert.</p>
          
          <form onSubmit={(e) => {
            e.preventDefault();
            const val = (e.currentTarget.elements.namedItem('key') as HTMLInputElement).value;
            if(val) saveApiKey(val);
          }} className="space-y-4">
            <input 
              name="key"
              type="password" 
              placeholder="Paste Gemini API Key here..." 
              className="w-full bg-black/50 border border-white/10 rounded-xl p-4 text-white focus:border-amber-500 outline-none transition-colors"
              autoFocus
            />
            <button type="submit" className="w-full bg-amber-500 text-black font-bold py-4 rounded-xl hover:bg-amber-600 transition-colors">
              Speichern & Starten
            </button>
            <p className="text-center mt-4">
              <a href="https://aistudio.google.com/app/apikey" target="_blank" className="text-[10px] text-slate-500 hover:text-amber-500 underline uppercase tracking-widest font-bold">
                Get API Key
              </a>
            </p>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-slate-200 pb-20 md:pb-0">
      <header className="sticky top-0 z-50 bg-black/60 backdrop-blur-xl border-b border-white/5 px-4 md:px-6 py-4 flex justify-between items-center safe-top">
        <div className="flex items-center gap-3">
          <div className="bg-amber-500 p-2 rounded-xl shadow-lg shadow-amber-500/20">
             <svg className="w-5 h-5 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
             </svg>
          </div>
          <div onClick={() => setShowKeyInput(true)} className="cursor-pointer">
            <h1 className="text-xl font-bold text-white italic leading-none font-serif tracking-tight">BaristaPro</h1>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em] mt-1">Mara X • VS3</p>
          </div>
        </div>
        {!isAdding && (
          <button 
            onClick={startNewCoffee} 
            className="bg-amber-500 hover:bg-amber-600 text-black px-4 py-2 rounded-xl font-bold shadow-lg shadow-amber-500/10 transition-transform active:scale-95 text-xs"
          >
            Neuer Shot
          </button>
        )}
      </header>

      <main className="max-w-4xl mx-auto p-4 md:p-8">
        <div className="space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl text-red-500 text-xs font-bold text-center animate-in fade-in slide-in-from-top-4">
              {error}
            </div>
          )}

          {isAdding ? (
            <div className="animate-in fade-in slide-in-from-bottom-8 duration-500">
              {searchStep ? (
                <section className="bg-[#111] p-6 md:p-8 rounded-[2rem] border border-white/5 shadow-2xl">
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold text-white font-serif">Kaffeesuche</h2>
                    <button onClick={() => setIsAdding(false)} className="text-slate-500 text-xs font-medium px-2 py-1">Abbrechen</button>
                  </div>
                  <form onSubmit={handleStartSearch} className="space-y-6">
                    <div className="relative">
                      <input 
                        type="text" required placeholder="Bohne oder Röster..."
                        className="w-full bg-[#1a1a1a] border border-white/10 rounded-2xl p-4 md:p-5 focus:border-amber-500/50 outline-none text-lg transition-all text-white placeholder:text-slate-600"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                      />
                      <button 
                        type="submit" disabled={isSearching}
                        className="absolute right-2 top-2 bottom-2 bg-amber-500 hover:bg-amber-600 text-black px-4 rounded-xl font-bold disabled:opacity-50 transition-all active:scale-95"
                      >
                        {isSearching ? '...' : 'Suche'}
                      </button>
                    </div>

                    {isSearching && (
                      <div className="py-10 text-center">
                        <div className="w-10 h-10 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                        <p className="text-slate-400 text-sm font-medium italic">Scanne das Web nach Rezepten...</p>
                      </div>
                    )}

                    {searchRecommendation && (
                      <div className="space-y-6 animate-in fade-in zoom-in duration-300">
                        {searchRecommendation.found ? (
                          <div className="bg-amber-500/5 border border-amber-500/10 rounded-[1.5rem] p-5">
                            <h3 className="text-amber-500 font-bold mb-4 flex items-center gap-2 text-sm uppercase tracking-wider">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                              Empfehlungen
                            </h3>
                            <div className="grid grid-cols-2 gap-3 mb-4">
                              <div className="bg-white/5 p-3 rounded-2xl">
                                <p className="text-[9px] text-slate-500 font-bold uppercase mb-1">Dose (In)</p>
                                <p className="text-xl font-mono text-white">{searchRecommendation.dose || '18'}g</p>
                              </div>
                              <div className="bg-white/5 p-3 rounded-2xl">
                                <p className="text-[9px] text-slate-500 font-bold uppercase mb-1">Yield (Out)</p>
                                <p className="text-xl font-mono text-white">{searchRecommendation.yield || '36'}g</p>
                              </div>
                              <div className="bg-white/5 p-3 rounded-2xl">
                                <p className="text-[9px] text-slate-500 font-bold uppercase mb-1">Zeit (Drops)</p>
                                <p className="text-xl font-mono text-white">{searchRecommendation.time || '28'}s</p>
                              </div>
                              <div className="bg-white/5 p-3 rounded-2xl">
                                <p className="text-[9px] text-slate-500 font-bold uppercase mb-1">Mara X PID</p>
                                <p className="text-xl font-mono text-white">{searchRecommendation.maraXSetting || 'I'}</p>
                              </div>
                            </div>
                            <p className="text-xs text-slate-400 italic leading-relaxed mb-4 border-l border-amber-500/30 pl-3">"{searchRecommendation.description}"</p>
                            
                            {searchRecommendation.sources.length > 0 && (
                              <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
                                {searchRecommendation.sources.slice(0, 2).map((s, i) => (
                                  <a key={i} href={s.uri} target="_blank" rel="noreferrer" className="text-[9px] bg-white/5 text-amber-500 px-3 py-1.5 rounded-full border border-white/5 font-bold uppercase truncate max-w-[140px]">
                                    {s.title}
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-center">
                            <p className="text-slate-400 text-sm">{searchRecommendation.description || "Kein spezifisches Rezept gefunden."} <br/><span className="text-amber-500/70">Nutze Standard-Setup (1:2 Ratio).</span></p>
                          </div>
                        )}
                        <button 
                          onClick={applyRecommendation} type="button"
                          className="w-full bg-amber-500 active:scale-95 text-black font-bold py-5 rounded-[1.5rem] shadow-xl transition-all text-lg"
                        >
                          Fortfahren
                        </button>
                      </div>
                    )}
                  </form>
                </section>
              ) : (
                <section className="bg-[#111] p-6 rounded-[2rem] border border-white/5 shadow-2xl">
                  <div className="flex justify-between items-center mb-8">
                    <h2 className="text-xl font-bold text-white font-serif truncate max-w-[70%]">{form.beanName}</h2>
                    <button onClick={() => setSearchStep(true)} className="text-amber-500 text-[10px] font-bold uppercase bg-amber-500/10 px-3 py-1 rounded-full">Bohne ändern</button>
                  </div>
                  
                  <div className="mb-8">
                    <ShotTimer onStop={(seconds) => setForm(prev => ({ ...prev, time: seconds }))} />
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-8">
                    <div className="grid grid-cols-3 gap-3 p-4 bg-white/5 rounded-3xl">
                      <div className="space-y-1 text-center">
                        <label className="text-[9px] uppercase text-slate-500 font-bold tracking-widest">In (g)</label>
                        <input type="number" step="0.1" className="w-full bg-transparent text-center text-2xl font-mono text-amber-500 outline-none" value={form.dose} onChange={e => setForm({...form, dose: Number(e.target.value)})} />
                      </div>
                      <div className="space-y-1 text-center border-x border-white/5">
                        <label className="text-[9px] uppercase text-slate-500 font-bold tracking-widest">Out (g)</label>
                        <input type="number" step="0.1" className="w-full bg-transparent text-center text-2xl font-mono text-amber-500 outline-none" value={form.yield} onChange={e => setForm({...form, yield: Number(e.target.value)})} />
                      </div>
                      <div className="space-y-1 text-center">
                        <label className="text-[9px] uppercase text-slate-500 font-bold tracking-widest">Zeit (s)</label>
                        <input type="number" className="w-full bg-transparent text-center text-2xl font-mono text-amber-500 outline-none" value={form.time} onChange={e => setForm({...form, time: Number(e.target.value)})} />
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="p-5 bg-white/5 rounded-3xl border border-white/5">
                        <label className="text-[9px] uppercase text-slate-500 font-bold tracking-widest block mb-4">Mara X PID Stufe</label>
                        <div className="flex gap-3">
                          {(['0', 'I', 'II'] as const).map(l => (
                            <button key={l} type="button" onClick={() => setForm({...form, maraXTempSetting: l})} className={`flex-1 py-4 rounded-2xl font-bold transition-all ${form.maraXTempSetting === l ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/20' : 'bg-[#1a1a1a] text-slate-500'}`}>{l}</button>
                          ))}
                        </div>
                      </div>
                      
                      <div className="p-5 bg-white/5 rounded-3xl border border-white/5">
                        <label className="text-[9px] uppercase text-slate-500 font-bold tracking-widest block mb-1">Varia VS3 Grind</label>
                        <input type="text" placeholder="z.B. 2.5" className="w-full bg-transparent text-xl text-amber-500 font-mono outline-none py-2" value={form.grindSetting} onChange={e => setForm({...form, grindSetting: e.target.value})} />
                      </div>

                      <div className="p-5 bg-white/5 rounded-3xl border border-white/5">
                        <h3 className="text-[9px] font-bold uppercase text-slate-500 tracking-widest mb-6">Flavor Log</h3>
                        <div className="space-y-6">
                          {[
                            {k: 'sourness', l: 'Säure'}, 
                            {k: 'bitterness', l: 'Bitter'}, 
                            {k: 'sweetness', l: 'Süße'}, 
                            {k: 'body', l: 'Körper'}, 
                            {k: 'overall', l: 'Qualität'}
                          ].map(f => (
                            <div key={f.k} className="flex items-center gap-4">
                              <span className="text-[10px] text-slate-400 w-12 font-medium">{f.l}</span>
                              <input type="range" min="1" max="5" className="flex-1 accent-amber-500 h-1.5" value={form.flavorProfile![f.k as keyof EspressoShot['flavorProfile']]} onChange={e => updateFlavor(f.k as keyof EspressoShot['flavorProfile'], Number(e.target.value))} />
                              <span className="text-xs font-bold text-amber-500 w-4">{form.flavorProfile![f.k as keyof EspressoShot['flavorProfile']]}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <button type="submit" className="w-full bg-amber-500 active:scale-95 text-black font-bold py-5 rounded-[1.5rem] shadow-2xl text-lg transition-all">Speichern & Analysieren</button>
                  </form>
                </section>
              )}
            </div>
          ) : (
            <div className="space-y-8 pb-10">
              {shots.length === 0 ? (
                <div className="bg-[#111] rounded-[2.5rem] p-12 text-center border border-white/5 mt-10">
                  <div className="w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                    <svg className="w-10 h-10 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  </div>
                  <h2 className="text-2xl font-bold text-white mb-3 font-serif italic">Bereit für den Shot?</h2>
                  <p className="text-slate-500 text-sm mb-8 leading-relaxed">Finde das perfekte Rezept für deine Bohnen auf deiner Mara X.</p>
                  <button onClick={startNewCoffee} className="bg-amber-500 text-black px-10 py-4 rounded-2xl font-bold shadow-xl active:scale-95 transition-all">Suchen & Starten</button>
                </div>
              ) : (
                <div 
                  className="bg-[#111] rounded-[2.5rem] p-8 text-center border border-white/5 relative overflow-hidden active:scale-95 transition-transform" 
                  onClick={startNewCoffee}
                >
                  <div className="absolute top-0 right-0 p-8 opacity-5">
                     <svg className="w-32 h-32 text-amber-500" fill="currentColor" viewBox="0 0 20 20"><path d="M5 4a1 1 0 00-2 0v7.268a2 2 0 000 3.464V16a1 1 0 102 0v-1.268a2 2 0 000-3.464V4z" /></svg>
                  </div>
                  <h2 className="text-3xl font-bold text-white mb-2 font-serif italic">Nächster Espresso</h2>
                  <p className="text-slate-500 text-sm mb-8">Kaffeesorte suchen & Dial-In Guide finden</p>
                  <div className="w-14 h-14 bg-amber-500 rounded-2xl flex items-center justify-center mx-auto shadow-2xl">
                    <svg className="w-7 h-7 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  </div>
                </div>
              )}

              {advice && (
                <section className="bg-white/5 rounded-[2rem] p-7 border border-amber-500/20 shadow-2xl animate-in fade-in zoom-in duration-700">
                  <div className="flex items-center gap-4 mb-8">
                    <div className="w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center text-black shadow-lg">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-white font-serif italic tracking-tight">Barista Coach</h2>
                      <p className="text-slate-500 text-[9px] font-bold uppercase tracking-[0.2em]">Equipment-Analyse</p>
                    </div>
                  </div>
                  <div className="space-y-6">
                    <div className="bg-black/40 p-5 rounded-2xl border border-white/5">
                      <p className="text-[9px] font-bold uppercase text-amber-500 mb-2">Diagnose</p>
                      <p className="text-slate-200 text-sm leading-relaxed">{advice.diagnosis}</p>
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                      <div className="bg-emerald-500/10 border border-emerald-500/20 p-5 rounded-2xl">
                        <p className="text-[9px] font-bold uppercase text-emerald-400 mb-2">Empfehlung</p>
                        <p className="text-slate-200 text-sm">{advice.recommendation}</p>
                      </div>
                      <div className="bg-amber-500/10 border border-amber-500/20 p-5 rounded-2xl">
                        <p className="text-[9px] font-bold uppercase text-amber-500 mb-2">Anpassung</p>
                        <p className="text-amber-500 font-bold text-xl leading-tight">{advice.adjustment}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-4">
                      <button 
                        onClick={repeatShot}
                        className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold py-4 rounded-2xl border border-white/10 transition-all active:scale-95 flex items-center justify-center gap-2 text-sm"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        Wiederholen
                      </button>
                      <button 
                        onClick={startNewCoffee}
                        className="flex-1 bg-amber-500 hover:bg-amber-600 text-black font-bold py-4 rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2 text-sm"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                        Andere Sorte
                      </button>
                    </div>
                  </div>
                </section>
              )}

              {loadingAdvice && (
                <div className="bg-[#111] rounded-[2rem] p-12 flex flex-col items-center gap-5 border border-white/5 animate-pulse">
                  <div className="w-10 h-10 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">Analysiere Profile...</p>
                </div>
              )}

              {shots.length > 0 && (
                <div className="space-y-8">
                   <div className="bg-[#111] p-6 rounded-[2rem] border border-white/5 shadow-xl overflow-hidden">
                      <h2 className="text-[10px] font-bold mb-6 text-slate-500 uppercase tracking-[0.2em]">Performance Trend</h2>
                      <div className="h-44 w-full -ml-4">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={[...shots].reverse()}>
                            <XAxis dataKey="timestamp" hide />
                            <YAxis stroke="#334155" fontSize={8} axisLine={false} tickLine={false} />
                            <Tooltip contentStyle={{ backgroundColor: '#000', border: '1px solid #333', borderRadius: '12px', fontSize: '10px' }} />
                            <Line type="monotone" dataKey="time" stroke="#f59e0b" strokeWidth={3} dot={false} />
                            <Line type="monotone" dataKey="flavorProfile.overall" stroke="#10b981" strokeWidth={1} dot={false} strokeDasharray="4 4" />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                   </div>

                   <section className="space-y-4">
                      <div className="flex justify-between items-end px-2 mb-2">
                        <h2 className="text-xl font-bold font-serif italic text-white tracking-tight">Journal</h2>
                        <span className="text-[9px] bg-white/5 px-3 py-1 rounded-full text-slate-500 font-bold uppercase">{shots.length} Einträge</span>
                      </div>
                      <div className="grid grid-cols-1 gap-4">
                        {shots.map(shot => (
                          <ShotCard 
                            key={shot.id} 
                            shot={shot} 
                            onDelete={(id) => setShots(shots.filter(s => s.id !== id))} 
                          />
                        ))}
                      </div>
                   </section>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {!isAdding && shots.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 md:hidden animate-in fade-in slide-in-from-bottom-10 duration-700">
           <button 
             onClick={startNewCoffee} 
             className="bg-amber-500 text-black px-8 py-4 rounded-2xl font-bold shadow-2xl flex items-center gap-3 active:scale-95 transition-transform"
           >
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
             Neuer Shot
           </button>
        </div>
      )}
    </div>
  );
};

// Root Rendering
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
