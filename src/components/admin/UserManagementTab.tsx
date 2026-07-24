import React, { useMemo, useState } from 'react';
import { Users, User, Building, Search, Ban, MessageSquare, Send, X, AlertTriangle } from 'lucide-react';
import { UserProfile, ProviderProfile, RentalOrder, GlobalConfig } from '../../types';
import UserCard from './UserCard';
import FleetInsightsModal from './FleetInsightsModal';
import { getFunctions, httpsCallable } from 'firebase/functions';

interface UserManagementTabProps {
  customers: UserProfile[];
  providers: ProviderProfile[];
  orders: RentalOrder[];
  config: GlobalConfig | null;
  handleToggleBlock: (type: 'users' | 'providers', id: string, currentStatus: boolean) => Promise<void>;
}

// Provider doc id: prefer the real id; fall back to phone_zip for legacy docs.
const providerDocId = (p: ProviderProfile) => p.id || `${p.phoneNumber}_${p.zipCode}`;

export default function UserManagementTab({ customers, providers, orders, config, handleToggleBlock }: UserManagementTabProps) {
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [search, setSearch] = useState('');
  // Selected entity for the insights modal — stored by id so it stays live as
  // Firestore streams in (e.g. after a block toggle).
  const [selected, setSelected] = useState<{ id: string; isProvider: boolean } | null>(null);
  const [bulkTitle, setBulkTitle] = useState('');
  const [bulkBody, setBulkBody] = useState('');
  const [bulkZipCode, setBulkZipCode] = useState('');
  const [targetAudience, setTargetAudience] = useState<'customers' | 'providers'>('providers');
  const [isSending, setIsSending] = useState(false);

  const handleSendBulkMessage = async () => {
    if (!bulkTitle.trim() || !bulkBody.trim()) return;
    
    setIsSending(true);
    try {
      const functions = getFunctions();
      const bulkMessageCall = httpsCallable(functions, 'bulkBroadcast');
      const result: any = await bulkMessageCall({
        title: bulkTitle,
        body: bulkBody,
        zipCode: bulkZipCode.trim() || undefined,
        target: targetAudience,
        data: { type: 'ADMIN_BROADCAST' }
      });
      
      if (result.data.success) {
        const { sent = 0, scanned = 0, withToken = 0, receipts } = result.data;
        let msg = `Broadcast queued.\n\n${targetAudience} scanned: ${scanned}\nWith a saved push token: ${withToken}\nAccepted by Expo: ${sent}`;
        if (withToken === 0) {
          msg += `\n\n⚠️ None of the matched ${targetAudience} have a push token saved, so nothing was sent. They likely denied notification permission, or the app hasn't registered a token.`;
        } else if (sent === 0) {
          msg += `\n\n⚠️ Tokens exist but none were valid Expo push tokens.`;
        } else if (receipts) {
          msg += `\n\n— Delivery receipts —\nDelivered: ${receipts.delivered}\nFailed: ${receipts.errored}\nPending: ${receipts.pending}`;
          const codes = Object.entries(receipts.errorsByCode || {});
          if (codes.length) {
            msg += `\n\n⚠️ Failures: ${codes.map(([c, n]) => `${c} ×${n}`).join(', ')}`;
            if (receipts.sample) msg += `\n${receipts.sample}`;
          }
          const problems = receipts.problems || [];
          if (problems.length) {
            msg += `\n\nNot delivered:\n${problems.map((p: any) => `• ${p.recipient} — ${p.status}${p.error ? ` (${p.error})` : ''}`).join('\n')}`;
          }
          if (receipts.delivered > 0 && receipts.errored === 0 && receipts.pending === 0) {
            msg += `\n\nExpo delivered all of these to APNs/FCM. If your phone still shows nothing, its token is stale (old install) or the app's notifications are off in device Settings — reopen the customer app to re-register the token, then retry.`;
          }
        }
        alert(msg);
        setShowBulkModal(false);
        setBulkTitle('');
        setBulkBody('');
        setBulkZipCode('');
        setTargetAudience('providers');
      }
    } catch (error: any) {
      console.error('Error sending bulk message:', error);
      alert('Failed to broadcast message: ' + (error.message || 'Unknown error'));
    } finally {
      setIsSending(false);
    }
  };

  const q = search.trim().toLowerCase();
  const filteredCustomers = useMemo(() => {
    if (!q) return customers;
    return customers.filter(c => (c.name || '').toLowerCase().includes(q) || (c.phoneNumber || '').toLowerCase().includes(q));
  }, [customers, q]);
  const filteredProviders = useMemo(() => {
    if (!q) return providers;
    return providers.filter(p => (p.businessName || '').toLowerCase().includes(q) || (p.phoneNumber || '').toLowerCase().includes(q));
  }, [providers, q]);

  // Resolve the selected entity from the latest props so the modal reflects
  // live changes (block status, new orders). Closes if the record disappears.
  const selectedEntity = useMemo(() => {
    if (!selected) return null;
    const found = selected.isProvider
      ? providers.find(p => providerDocId(p) === selected.id)
      : customers.find(c => c.phoneNumber === selected.id);
    return found ?? null;
  }, [selected, providers, customers]);

  return (
    <div>
      <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tighter">User Management</h2>
          <p className="text-stone-500 text-sm font-bold uppercase font-mono">Control customer and location access</p>
        </div>
        <button 
          onClick={() => setShowBulkModal(true)}
          className="bg-black text-white px-6 py-3 font-black uppercase text-xs shadow-brutalist hover:bg-brand-green hover:text-black transition-all active:translate-x-1 active:translate-y-1 active:shadow-none flex items-center gap-2 border-2 border-black"
        >
          <MessageSquare size={16} /> Bulk Message Tool
        </button>
      </header>

      <div className="mt-4 mb-8 flex gap-4">
         <div className="relative flex-1">
           <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={16}/>
           <input
             type="text"
             value={search}
             onChange={e => setSearch(e.target.value)}
             placeholder="Search by name or phone..."
             className="w-full pl-10 pr-4 py-3 border-4 border-stone-100 focus:border-black transition-all outline-none font-bold uppercase text-xs"
           />
         </div>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <section>
          <h3 className="text-xs font-black uppercase text-stone-400 mb-4 tracking-widest flex items-center gap-2"><User size={14}/> Customers ({filteredCustomers.length})</h3>
          <div className="space-y-2">
            {filteredCustomers.map(u => (
              <UserCard
                key={u.phoneNumber}
                profile={u}
                onOpen={() => setSelected({ id: u.phoneNumber, isProvider: false })}
                onBlock={() => handleToggleBlock('users', u.phoneNumber, !!u.isBlocked)}
              />
            ))}
          </div>
        </section>
        <section>
          <h3 className="text-xs font-black uppercase text-stone-400 mb-4 tracking-widest flex items-center gap-2"><Building size={14}/> Locations ({filteredProviders.length})</h3>
          <div className="space-y-2">
            {filteredProviders.map(p => {
              const pid = providerDocId(p);
              return (
                <UserCard
                  key={pid}
                  profile={p}
                  onOpen={() => setSelected({ id: pid, isProvider: true })}
                  onBlock={() => handleToggleBlock('providers', pid, !!p.isBlocked)}
                  isProvider
                />
              );
            })}
          </div>
        </section>
      </div>

      {selectedEntity && (
        <FleetInsightsModal
          entity={selectedEntity}
          isProvider={selected!.isProvider}
          orders={orders}
          config={config}
          onClose={() => setSelected(null)}
          onToggleBlock={() => handleToggleBlock(
            selected!.isProvider ? 'providers' : 'users',
            selected!.id,
            !!selectedEntity.isBlocked,
          )}
        />
      )}

      {/* Bulk Message Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white border-4 border-black p-8 w-full max-w-lg shadow-brutalist animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-2xl font-black uppercase italic tracking-tighter">Bulk Broadcast</h3>
              <button 
                onClick={() => setShowBulkModal(false)} 
                className="hover:text-brand-green-dark transition-colors p-1 border-2 border-transparent hover:border-black rounded"
              >
                <X size={24}/>
              </button>
            </div>
            
            <div className="space-y-6">
              <div>
                <label className="block text-[10px] font-black uppercase mb-2 tracking-widest text-stone-500">Target Audience</label>
                <div className="flex gap-2 bg-stone-100 p-1 border-2 border-black">
                  <button 
                    onClick={() => setTargetAudience('providers')}
                    className={`flex-1 py-2 font-black uppercase text-[10px] transition-all ${targetAudience === 'providers' ? 'bg-black text-white shadow-brutalist' : 'text-stone-500 hover:text-black'}`}
                  >
                    Providers
                  </button>
                  <button 
                    onClick={() => setTargetAudience('customers')}
                    className={`flex-1 py-2 font-black uppercase text-[10px] transition-all ${targetAudience === 'customers' ? 'bg-black text-white shadow-brutalist' : 'text-stone-500 hover:text-black'}`}
                  >
                    Customers
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase mb-2 tracking-widest text-stone-500">Target ZIP Code (Optional)</label>
                <input 
                  type="text" 
                  value={bulkZipCode}
                  onChange={e => setBulkZipCode(e.target.value)}
                  placeholder="e.g. 10025 (Leave empty for all)"
                  className="w-full border-4 border-black p-3 font-black text-sm focus:outline-none focus:bg-stone-50"
                  maxLength={5}
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase mb-2 tracking-widest text-stone-500">Notification Title</label>
                <input 
                  type="text" 
                  value={bulkTitle}
                  onChange={e => setBulkTitle(e.target.value)}
                  placeholder="e.g. System Maintenance Window"
                  className="w-full border-4 border-black p-3 font-black text-sm focus:outline-none focus:bg-stone-50"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase mb-2 tracking-widest text-stone-500">Message Body</label>
                <textarea 
                  value={bulkBody}
                  onChange={e => setBulkBody(e.target.value)}
                  placeholder="Type your message to all providers..."
                  rows={5}
                  className="w-full border-4 border-black p-3 font-bold text-sm focus:outline-none focus:bg-stone-50 resize-none"
                />
              </div>
            </div>

            <div className="mt-10 flex gap-4">
              <button 
                onClick={() => setShowBulkModal(false)}
                className="flex-1 border-4 border-black py-3 font-black uppercase text-xs hover:bg-stone-100 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleSendBulkMessage}
                disabled={isSending || !bulkTitle.trim() || !bulkBody.trim()}
                className="flex-[2] bg-black text-white py-3 font-black uppercase text-xs shadow-brutalist-green hover:bg-brand-green hover:text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 border-2 border-black"
              >
                {isSending ? (
                  <span className="animate-pulse">Broadcasting...</span>
                ) : (
                  <><Send size={16}/> Dispatch Broadcast</>
                )}
              </button>
            </div>
            
            <div className="mt-8 p-4 bg-brand-green/10 border-2 border-dashed border-brand-green rounded">
              <p className="text-[10px] text-stone-600 font-bold uppercase leading-tight flex items-start gap-2">
                <AlertTriangle size={14} className="shrink-0 text-brand-green-dark" />
                This will trigger a push notification to {bulkZipCode ? `${targetAudience} in ZIP ${bulkZipCode}` : `all ${targetAudience}`}.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}