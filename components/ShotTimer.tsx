
import React, { useState, useEffect, useRef } from 'react';

interface ShotTimerProps {
  onStop: (seconds: number) => void;
}

type TimerState = 'IDLE' | 'PUMPING' | 'EXTRACTING';

export const ShotTimer: React.FC<ShotTimerProps> = ({ onStop }) => {
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
