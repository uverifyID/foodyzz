import React from 'react';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: string;
  color?: string;
}

export default function StatCard({ title, value, icon, trend, color = "bg-white" }: StatCardProps) {
  return (
    <div className={`${color} border-4 border-black p-6 shadow-brutalist transition-transform hover:-translate-x-1 hover:-translate-y-1`}>
      <div className="flex justify-between items-start mb-4">
        <div className="p-2 bg-white border-2 border-black rounded shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
          {React.cloneElement(icon as React.ReactElement, { size: 20 })}
        </div>
        {trend && (
          <span className="text-[10px] font-black uppercase bg-white px-2 py-0.5 border-2 border-black rounded shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
            {trend}
          </span>
        )}
      </div>
      <h4 className="text-[10px] font-black uppercase text-stone-500 mb-1 tracking-widest">{title}</h4>
      <p className="text-2xl font-black font-mono tracking-tighter">{value}</p>
    </div>
  );
}