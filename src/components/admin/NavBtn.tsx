import React from 'react';
import { MessageSquare } from 'lucide-react';

interface NavBtnProps {
    icon: React.ReactNode;
    label: string;
    active: boolean;
    onClick: () => void;
    badge?: boolean;
}

export default function NavBtn({ icon, label, active, onClick, badge }: NavBtnProps) {
    return (
        <button onClick={onClick} className={`p-3 rounded-xl flex items-center gap-4 transition-all relative ${active ? 'bg-brand-green text-black' : 'text-stone-500 hover:text-white hover:bg-stone-900'}`}>
            {icon}
            <span className="hidden md:block font-black uppercase text-[11px] tracking-widest">{label}</span>
            {badge && <div className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full animate-pulse border border-black" />}
        </button>
    );
}
