import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MessageSquare, Send, X, User, Building2 } from 'lucide-react';
import { SupportMessage, AppRole } from '../../types';

interface ChatManagerTabProps {
  supportThreads: Record<string, SupportMessage[]>;
  onSendReply: (userPhone: string, text: string) => Promise<void>;
  onMarkRead: (userPhone: string) => Promise<void>;
}

export default function ChatManagerTab({ supportThreads, onSendReply, onMarkRead }: ChatManagerTabProps) {
  const [pinnedPhones, setPinnedPhones] = useState<(string | null)[]>([null, null, null]);
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({});

  // Memoized so typing in the reply box (which updates replyTexts on every
  // keystroke → re-render) doesn't re-sort every thread and re-reduce every
  // message. Recomputes only when the underlying threads change.
  const sortedThreads = useMemo(() => Object.entries(supportThreads).sort((a, b) => {
    const aLast = a[1][a[1].length - 1]?.timestamp || '';
    const bLast = b[1][b[1].length - 1]?.timestamp || '';
    return bLast.localeCompare(aLast);
  }), [supportThreads]);

  const totalUnread = useMemo(() => sortedThreads.reduce((sum, [, msgs]) =>
    sum + msgs.filter(m => !m.isReadByAdmin && m.senderPhone !== 'admin' && m.senderPhone !== 'system').length, 0
  ), [sortedThreads]);

  const openThread = (phone: string) => {
    if (pinnedPhones.includes(phone)) return;
    const emptyIdx = pinnedPhones.findIndex(p => p === null);
    if (emptyIdx >= 0) {
      const updated = [...pinnedPhones];
      updated[emptyIdx] = phone;
      setPinnedPhones(updated);
    } else {
      // Replace oldest slot (shift left, add new at end)
      setPinnedPhones([pinnedPhones[1], pinnedPhones[2], phone]);
    }
    onMarkRead(phone);
  };

  const closeWindow = (idx: number) => {
    const updated = [...pinnedPhones];
    updated[idx] = null;
    setPinnedPhones(updated);
  };

  const handleSend = async (phone: string) => {
    const text = (replyTexts[phone] || '').trim();
    if (!text) return;
    setReplyTexts(prev => ({ ...prev, [phone]: '' }));
    await onSendReply(phone, text);
  };

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 4rem)' }}>
      <header className="mb-6 flex-shrink-0">
        <h2 className="text-3xl font-black uppercase tracking-tighter italic flex items-center gap-3">
          <MessageSquare className="text-brand-green-dark" size={28} />
          Chat Manager
          {totalUnread > 0 && (
            <span className="bg-red-500 text-white text-xs font-black px-2 py-0.5 rounded-full">{totalUnread} unread</span>
          )}
        </h2>
        <p className="text-stone-500 text-sm font-bold uppercase font-mono">
          Up to 3 conversations simultaneously — click a thread to open
        </p>
      </header>

      <div className="flex flex-1 gap-4 overflow-hidden min-h-0">
        {/* Thread List */}
        <div className="w-56 flex-shrink-0 bg-white border-4 border-black shadow-brutalist flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b-4 border-black bg-black text-white flex-shrink-0">
            <h3 className="font-black uppercase text-[10px] tracking-widest">Active Threads</h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            {sortedThreads.length === 0 ? (
              <div className="p-4 text-center text-stone-400 text-xs font-mono mt-4">No threads yet</div>
            ) : sortedThreads.map(([phone, messages]) => {
              const last = messages[messages.length - 1];
              const unread = messages.filter(m => !m.isReadByAdmin && m.senderPhone !== 'admin' && m.senderPhone !== 'system').length;
              const isOpen = pinnedPhones.includes(phone);
              return (
                <button
                  key={phone}
                  onClick={() => openThread(phone)}
                  className={`w-full text-left p-3 border-b-2 border-stone-100 hover:bg-stone-50 transition-colors relative ${
                    isOpen ? 'bg-brand-green/10 border-l-4 border-l-brand-green' : 'border-l-4 border-l-transparent'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    {last.userRole === AppRole.CUSTOMER
                      ? <User size={11} className="text-blue-500 flex-shrink-0" />
                      : <Building2 size={11} className="text-green-500 flex-shrink-0" />}
                    <span className="font-black text-[11px] truncate flex-1">{last.userName}</span>
                    {unread > 0 && (
                      <span className="bg-red-500 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0">
                        {unread > 9 ? '9+' : unread}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-stone-500 truncate font-mono">{last.text}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3 Chat Windows */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 min-h-0">
          {pinnedPhones.map((phone, idx) => (
            <ChatWindow
              key={idx}
              phone={phone}
              slotIndex={idx}
              messages={phone ? (supportThreads[phone] || []) : []}
              replyText={phone ? (replyTexts[phone] || '') : ''}
              onReplyChange={(text) => { if (phone) setReplyTexts(prev => ({ ...prev, [phone]: text })); }}
              onSend={() => { if (phone) handleSend(phone); }}
              onClose={() => closeWindow(idx)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface ChatWindowProps {
  phone: string | null;
  slotIndex: number;
  messages: SupportMessage[];
  replyText: string;
  onReplyChange: (text: string) => void;
  onSend: () => void;
  onClose: () => void;
}

function ChatWindow({ phone, slotIndex, messages, replyText, onReplyChange, onSend, onClose }: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!phone) {
    return (
      <div className="bg-stone-100 border-4 border-dashed border-stone-300 flex flex-col items-center justify-center text-stone-400">
        <MessageSquare size={28} className="mb-2 opacity-25" />
        <p className="text-[10px] font-black uppercase tracking-widest opacity-40">Slot {slotIndex + 1}</p>
        <p className="text-[9px] font-mono opacity-30 mt-1">Click a thread to open</p>
      </div>
    );
  }

  const firstMsg = messages[0];
  const userName = firstMsg?.userName || phone;
  const userRole = firstMsg?.userRole;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="bg-white border-4 border-black shadow-brutalist flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-black text-white flex-shrink-0">
        {userRole === AppRole.CUSTOMER
          ? <User size={13} className="text-blue-400 flex-shrink-0" />
          : <Building2 size={13} className="text-green-400 flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="font-black text-[11px] truncate uppercase">{userName}</p>
          <p className="text-[9px] text-stone-400 font-mono capitalize">{userRole}</p>
        </div>
        <button
          onClick={onClose}
          className="flex-shrink-0 p-1 hover:bg-brand-green hover:text-black rounded transition-colors"
        >
          <X size={11} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
        {messages.length === 0 ? (
          <p className="text-center text-[10px] text-stone-400 font-mono mt-4">No messages yet</p>
        ) : messages.map((msg, i) => {
          const isAdmin = msg.senderPhone === 'admin';
          const isBot = msg.senderPhone === 'system';
          return (
            <div key={msg.id || i} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[88%] px-2 py-1.5 border-2 text-xs ${
                isAdmin
                  ? 'bg-black text-white border-black shadow-[2px_2px_0px_0px_rgba(255,77,0,1)]'
                  : isBot
                  ? 'bg-stone-100 text-stone-500 border-dashed border-stone-300'
                  : 'bg-white border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
              }`}>
                <p className="font-black text-[9px] uppercase mb-0.5 opacity-50">{msg.senderName}</p>
                <p className="leading-snug text-[11px]">{msg.text}</p>
                <p className="text-[8px] opacity-40 text-right mt-0.5 font-mono">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Reply Input */}
      <div className="flex-shrink-0 border-t-4 border-black p-2 flex gap-1.5">
        <input
          type="text"
          value={replyText}
          onChange={e => onReplyChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Reply… (Enter to send)"
          className="flex-1 border-2 border-black px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:border-brand-green min-w-0"
        />
        <button
          onClick={onSend}
          disabled={!replyText.trim()}
          className="bg-brand-green text-black border-2 border-black p-1.5 shadow-brutalist hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  );
}
