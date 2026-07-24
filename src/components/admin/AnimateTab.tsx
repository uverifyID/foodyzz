import React from 'react';

interface AnimateTabProps {
    children: React.ReactNode;
    active: boolean;
}

export default function AnimateTab({ children, active }: AnimateTabProps) {
    if (!active) return null;
    return <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">{children}</div>;
}
