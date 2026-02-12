
import React from 'react';
import { EspressoShot } from '../types';

interface ShotCardProps {
  shot: EspressoShot;
  onDelete?: (id: string) => void;
}

export const ShotCard: React.FC<ShotCardProps> = ({ shot, onDelete }) => {
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
