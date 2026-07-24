import React from 'react';
import { User, Building, ShieldAlert, ShieldCheck } from 'lucide-react';
import { UserProfile, ProviderProfile } from '../../types';

interface UserCardProps {
  profile: UserProfile | ProviderProfile;
  onBlock: () => void;
  onOpen?: () => void;
  isProvider?: boolean;
}

export default function UserCard({ profile, onBlock, onOpen, isProvider }: UserCardProps) {
  const isBlocked = !!profile.isBlocked;

  return (
    <div
      onClick={onOpen}
      role={onOpen ? 'button' : undefined}
      className={`bg-white border-2 border-black p-4 shadow-brutalist flex items-center justify-between group transition-colors ${isBlocked ? 'bg-stone-50' : 'hover:bg-stone-50'} ${onOpen ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-center gap-4">
        <div className={`w-10 h-10 border-2 border-black flex items-center justify-center rounded ${isProvider ? 'bg-brand-green' : 'bg-brand-green'}`}>
          {isProvider ? <Building size={18}/> : <User size={18}/>}
        </div>
        <div className="min-w-0 flex-1">
          <h4 className={`font-black uppercase text-xs truncate ${isBlocked ? 'text-stone-400 line-through' : ''}`}>
            {isProvider ? (profile as ProviderProfile).businessName : (profile as UserProfile).name}
          </h4>
          <p className="text-[10px] font-mono text-stone-400">{profile.phoneNumber}</p>
        </div>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onBlock(); }}
        className={`p-2 border-2 border-black transition-all ${isBlocked ? 'bg-emerald-400 text-white shadow-none translate-x-0.5 translate-y-0.5' : 'bg-white text-stone-400 hover:text-rose-500 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-x-0.5 hover:-translate-y-0.5'}`}
        title={isBlocked ? "Unblock User" : "Block User"}
      >
        {isBlocked ? <ShieldCheck size={16}/> : <ShieldAlert size={16}/>}
      </button>
    </div>
  );
}