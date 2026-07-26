import React, { useEffect, useMemo, useState } from 'react';
import { Users2, Search, Send, Ban, Copy, Check, ShieldCheck, X, UserMinus } from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, callable } from '../../firebase';
import { ProviderProfile } from '../../types';
import { formatPhoneForDisplay } from '../../utils/helpers';

/**
 * Store team management — who can run each FoodyzzHQ store.
 *
 * A store's doc id embeds whoever created it, which used to make the creator its
 * only possible user. Access is now `providers/{id}/members/{E164phone}`, and
 * someone joins by redeeming a single-use code issued for their number alone.
 *
 * Nothing here writes Firestore directly. `invites` is deny-all to every client
 * (the code IS the credential) and `members` is server-only, so issuing, revoking
 * and removing all go through admin-gated callables. The roster itself IS
 * readable to an admin, so that one is a live subscription.
 */

interface Props {
  providers: ProviderProfile[];
}

type Member = { id: string; phone: string; role: 'owner' | 'staff'; name?: string; addedAt?: string };
type Invite = {
  codeHint: string; phone: string; providerId: string; name: string | null;
  state: 'open' | 'used' | 'expired' | 'revoked'; createdAt: string; expiresAt: string;
};

const issueInvite = callable('adminIssueStoreInvite');
const listInvites = callable('adminListStoreInvites');
const revokeInvite = callable('adminRevokeStoreInvite');
const removeMember = callable('adminRemoveStoreMember');

const STATE_STYLE: Record<Invite['state'], string> = {
  open: 'bg-emerald-100 text-emerald-700',
  used: 'bg-stone-200 text-stone-600',
  expired: 'bg-amber-100 text-amber-700',
  revoked: 'bg-rose-100 text-rose-700',
};

const storeLabel = (p: ProviderProfile) => p.businessName || `Unnamed · ${p.zipCode}`;
const storeId = (p: ProviderProfile) => p.id || `${p.phoneNumber}_${p.zipCode}`;

export default function StoreTeamTab({ providers }: Props) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Invite form
  const [showInvite, setShowInvite] = useState(false);
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteDays, setInviteDays] = useState('14');
  // The issued code, shown once. It is never returned by the listing, so if the
  // admin loses it the only remedy is to re-invite (which withdraws this one).
  const [issued, setIssued] = useState<{ code: string; phone: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...providers]
      .filter((p) => !q || storeLabel(p).toLowerCase().includes(q) || storeId(p).includes(q))
      .sort((a, b) => storeLabel(a).localeCompare(storeLabel(b)));
  }, [providers, search]);

  const selected = useMemo(
    () => sorted.find((p) => storeId(p) === selectedId) ?? null,
    [sorted, selectedId],
  );

  // Roster: a live subscription, since firestore.rules lets an admin read members.
  useEffect(() => {
    if (!selectedId) { setMembers([]); return; }
    setMembersLoading(true);
    return onSnapshot(
      collection(db, 'providers', selectedId, 'members'),
      (snap) => {
        setMembers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Member)));
        setMembersLoading(false);
      },
      (e) => { console.error('members listener failed:', e); setMembersLoading(false); },
    );
  }, [selectedId]);

  // Invites must be pulled through a callable — the collection is unreadable to
  // clients by design, so there is no snapshot to subscribe to.
  const refreshInvites = React.useCallback(async (providerId: string) => {
    try {
      const res: any = await listInvites({ providerId });
      setInvites(res.data.invites || []);
    } catch (e: any) {
      console.error('invite list failed:', e);
      setInvites([]);
    }
  }, []);

  useEffect(() => {
    if (selectedId) refreshInvites(selectedId);
    else setInvites([]);
  }, [selectedId, refreshInvites]);

  const openInviteForm = () => {
    setInvitePhone(''); setInviteName(''); setInviteDays('14');
    setIssued(null); setCopied(false); setError(null);
    setShowInvite(true);
  };

  const handleIssue = async () => {
    if (!selectedId || !invitePhone.trim()) return;
    setBusy(true); setError(null);
    try {
      const res: any = await issueInvite({
        providerId: selectedId,
        phone: invitePhone.trim(),
        name: inviteName.trim() || undefined,
        ttlDays: Number(inviteDays) || 14,
      });
      setIssued(res.data);
      await refreshInvites(selectedId);
    } catch (e: any) {
      setError(e?.message || 'Could not issue the invite.');
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (inv: Invite) => {
    if (!selectedId) return;
    if (!window.confirm(`Withdraw the invite for ${formatPhoneForDisplay(inv.phone)}? They will not be able to join with it.`)) return;
    setBusy(true); setError(null);
    try {
      // By store+phone, not by code: the listing never returns codes.
      await revokeInvite({ providerId: selectedId, phone: inv.phone });
      await refreshInvites(selectedId);
    } catch (e: any) {
      setError(e?.message || 'Could not revoke the invite.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (m: Member) => {
    if (!selectedId) return;
    if (!window.confirm(
      `Remove ${formatPhoneForDisplay(m.phone)} from ${selected ? storeLabel(selected) : 'this store'}?\n\n` +
      'They keep their session until it is re-evaluated: write access goes on their next action, the store itself on their next sign-in.',
    )) return;
    setBusy(true); setError(null);
    try {
      await removeMember({ providerId: selectedId, phone: m.phone });
    } catch (e: any) {
      setError(e?.message || 'Could not remove that member.');
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy — select the code and copy it manually.');
    }
  };

  return (
    <div>
      <header className="mb-8">
        <h2 className="text-3xl font-black uppercase tracking-tighter">Store Teams</h2>
        <p className="text-stone-500 text-sm font-bold uppercase font-mono">
          Who can run each FoodyzzHQ store &middot; invite by phone number
        </p>
      </header>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4" role="alert">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Store list */}
        <div className="lg:col-span-1">
          <div className="relative mb-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search stores"
              className="w-full pl-9 p-3 border-2 border-black font-bold text-sm focus:outline-none focus:bg-stone-50"
            />
          </div>
          <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
            {sorted.length === 0 ? (
              <div className="p-12 text-center border-4 border-dashed border-stone-200 font-black uppercase text-xs text-stone-400">
                No stores
              </div>
            ) : sorted.map((p) => {
              const id = storeId(p);
              const active = id === selectedId;
              return (
                <button
                  key={id}
                  onClick={() => setSelectedId(id)}
                  className={`w-full text-left p-4 border-2 transition-all ${
                    active ? 'border-black bg-brand-green text-black shadow-brutalist' : 'border-stone-200 hover:border-black bg-white'
                  }`}
                >
                  <div className="font-black uppercase text-sm tracking-tight">{storeLabel(p)}</div>
                  <div className="font-mono text-[10px] font-bold uppercase opacity-70">
                    {id} &middot; {p.onboarded ? 'live' : 'setup'}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Detail */}
        <div className="lg:col-span-2">
          {!selected ? (
            <div className="p-12 text-center border-4 border-dashed border-stone-200 font-black uppercase text-xs text-stone-400">
              Pick a store to see its team
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-4 border-b-4 border-black pb-4">
                <div>
                  <h3 className="text-2xl font-black uppercase italic tracking-tighter">{storeLabel(selected)}</h3>
                  <p className="font-mono text-[10px] font-bold uppercase text-stone-500">{storeId(selected)}</p>
                </div>
                <button
                  onClick={openInviteForm}
                  className="shrink-0 bg-black text-white px-5 py-3 font-black uppercase text-xs shadow-brutalist-green border-2 border-black hover:bg-brand-green hover:text-black flex items-center gap-2"
                >
                  <Send size={14} /> Invite
                </button>
              </div>

              {/* Members */}
              <section>
                <h4 className="font-black uppercase text-xs tracking-widest text-stone-500 mb-3">
                  Members ({members.length})
                </h4>
                {membersLoading ? (
                  <p className="font-mono text-xs text-stone-400 uppercase">Loading…</p>
                ) : members.length === 0 ? (
                  <div className="bg-amber-50 border-2 border-amber-300 text-amber-800 p-4 font-mono text-xs">
                    No members. Nobody can write to this store — run
                    <span className="font-black"> npm run backfill:members </span>
                    to record its original owner.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {members.map((m) => (
                      <div key={m.id} className="flex items-center gap-3 p-4 border-2 border-stone-200 bg-white">
                        <ShieldCheck size={16} className={m.role === 'owner' ? 'text-brand-green-dark' : 'text-stone-400'} />
                        <div className="flex-1 min-w-0">
                          <div className="font-black uppercase text-sm">{m.name || formatPhoneForDisplay(m.phone)}</div>
                          <div className="font-mono text-[10px] font-bold uppercase text-stone-500">
                            {formatPhoneForDisplay(m.phone)} &middot; {m.role}
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemove(m)}
                          disabled={busy}
                          title="Remove from this store"
                          className="p-2 border-2 border-stone-200 hover:border-rose-500 hover:text-rose-600 disabled:opacity-40"
                        >
                          <UserMinus size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Invites */}
              <section>
                <h4 className="font-black uppercase text-xs tracking-widest text-stone-500 mb-3">Invites</h4>
                {invites.length === 0 ? (
                  <p className="font-mono text-xs text-stone-400 uppercase">None issued</p>
                ) : (
                  <div className="space-y-2">
                    {invites.map((inv) => (
                      <div key={`${inv.phone}-${inv.createdAt}`} className="flex items-center gap-3 p-4 border-2 border-stone-200 bg-white">
                        <div className="flex-1 min-w-0">
                          <div className="font-black uppercase text-sm">
                            {inv.name || formatPhoneForDisplay(inv.phone)}
                          </div>
                          <div className="font-mono text-[10px] font-bold uppercase text-stone-500">
                            {formatPhoneForDisplay(inv.phone)} &middot; ends &hellip;{inv.codeHint} &middot;{' '}
                            {inv.state === 'open' ? `expires ${inv.expiresAt.slice(0, 10)}` : inv.expiresAt.slice(0, 10)}
                          </div>
                        </div>
                        <span className={`px-2 py-1 text-[10px] font-black uppercase rounded ${STATE_STYLE[inv.state]}`}>
                          {inv.state}
                        </span>
                        {inv.state === 'open' && (
                          <button
                            onClick={() => handleRevoke(inv)}
                            disabled={busy}
                            title="Withdraw this invite"
                            className="p-2 border-2 border-stone-200 hover:border-rose-500 hover:text-rose-600 disabled:opacity-40"
                          >
                            <Ban size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>

      {/* Invite modal */}
      {showInvite && selected && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white border-4 border-black p-8 w-full max-w-lg shadow-brutalist">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-2xl font-black uppercase italic tracking-tighter">
                {issued ? 'Invite Issued' : 'Invite to Store'}
              </h3>
              <button onClick={() => setShowInvite(false)} className="hover:text-brand-green-dark"><X size={24} /></button>
            </div>

            {issued ? (
              <div className="space-y-6">
                <div>
                  <p className="text-[10px] font-black uppercase mb-2 tracking-widest text-stone-500">
                    Code for {formatPhoneForDisplay(issued.phone)}
                  </p>
                  <div className="flex items-stretch gap-2">
                    <div className="flex-1 border-4 border-black p-4 font-mono text-3xl font-black tracking-[0.3em] text-center select-all">
                      {issued.code}
                    </div>
                    <button
                      onClick={copyCode}
                      className="px-4 border-4 border-black font-black uppercase text-xs hover:bg-brand-green"
                    >
                      {copied ? <Check size={18} /> : <Copy size={18} />}
                    </button>
                  </div>
                </div>
                {/* Said plainly, because it is not recoverable: the listing returns
                    only the last 3 characters, by design. */}
                <p className="font-mono text-xs text-stone-600 leading-relaxed">
                  Shown once — it is not stored anywhere you can read it back. Give it to them
                  directly. They enter their phone number and this code on the FoodyzzHQ
                  sign-in screen; it works once, from that number only, and expires{' '}
                  {issued.expiresAt.slice(0, 10)}. Re-inviting issues a new code and cancels this one.
                </p>
                <button
                  onClick={() => setShowInvite(false)}
                  className="w-full bg-black text-white py-3 font-black uppercase text-xs shadow-brutalist-green hover:bg-brand-green hover:text-black"
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <label className="block text-[10px] font-black uppercase mb-2 tracking-widest text-stone-500">
                    Phone number
                  </label>
                  <input
                    value={invitePhone}
                    onChange={(e) => setInvitePhone(e.target.value)}
                    placeholder="+1 402 555 1234"
                    className="w-full border-4 border-black p-3 font-black text-sm focus:outline-none focus:bg-stone-50"
                  />
                  <p className="mt-1 font-mono text-[10px] text-stone-500">
                    The code will only work from this number.
                  </p>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase mb-2 tracking-widest text-stone-500">
                    Name (optional)
                  </label>
                  <input
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="Sam"
                    className="w-full border-4 border-black p-3 font-black text-sm focus:outline-none focus:bg-stone-50"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase mb-2 tracking-widest text-stone-500">
                    Expires in (days)
                  </label>
                  <input
                    value={inviteDays}
                    onChange={(e) => setInviteDays(e.target.value.replace(/\D/g, ''))}
                    inputMode="numeric"
                    className="w-full border-4 border-black p-3 font-black text-sm focus:outline-none focus:bg-stone-50"
                  />
                </div>
                <div className="mt-10 flex gap-4">
                  <button
                    onClick={() => setShowInvite(false)}
                    className="flex-1 border-4 border-black py-3 font-black uppercase text-xs hover:bg-stone-100"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleIssue}
                    disabled={busy || !invitePhone.trim()}
                    className="flex-[2] bg-black text-white py-3 font-black uppercase text-xs shadow-brutalist-green hover:bg-brand-green hover:text-black disabled:opacity-50"
                  >
                    {busy ? 'Issuing…' : 'Issue Code'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
