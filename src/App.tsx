import React, { useState, useEffect, Suspense, lazy } from 'react';
import { BarChart3, Users, LayoutDashboard, LogOut, Settings, MessageSquare, Menu, X, Bike, Contact } from 'lucide-react';
import { onAuthStateChanged, signOut, signInWithEmailAndPassword, getMultiFactorResolver, multiFactor, User, MultiFactorResolver, MultiFactorError } from 'firebase/auth';
import { auth, db, subscribeToGlobalConfig } from './firebase';
import MfaChallenge from './components/auth/MfaChallenge';
import MfaEnroll from './components/auth/MfaEnroll';
import { collection, onSnapshot, query, orderBy, limit, doc, updateDoc, addDoc, writeBatch } from 'firebase/firestore';
import { DailyStats, ProviderPerformance, UserProfile, ProviderProfile, GlobalConfig, SupportMessage, RentalOrder, LogisticsConfig } from './types';

// Code-split each tab so the heavy AnalyticsTab (recharts) and the other tabs are
// not bundled into the pre-login chunk — they load on demand when first opened.
const AnalyticsTab = lazy(() => import('./components/admin/AnalyticsTab'));
const UserManagementTab = lazy(() => import('./components/admin/UserManagementTab'));
const OperationsTab = lazy(() => import('./components/admin/OperationsTab'));
const GlobalConfigTab = lazy(() => import('./components/admin/GlobalConfigTab'));
const ChatManagerTab = lazy(() => import('./components/admin/ChatManagerTab'));
const BikesTab = lazy(() => import('./components/admin/BikesTab'));
const LicensesTab = lazy(() => import('./components/admin/LicensesTab'));

type TabKey = 'analytics' | 'users' | 'ops' | 'bikes' | 'licenses' | 'settings' | 'chat';

// Shape of stats/platformCounts, maintained server-side by the Cloud Functions
// order/user/provider triggers. All fields optional — the doc is built up by
// incremental writes and may be partially populated before a backfill.
interface PlatformCounts {
  ordersTotal?: number;
  ordersByStatus?: Record<string, number>;
  usersTotal?: number;
  providersTotal?: number;
  pendingLicenses?: number;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  // Foodyzz runs a single admin account. Access is the `admin` custom claim —
  // there is no second portal and no self-signup, so this is a plain boolean
  // rather than the multi-role router the bike platform needed.
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [activeTab, setActiveTab] = useState<TabKey>('analytics');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [providerPerf, setProviderPerf] = useState<ProviderPerformance[]>([]);
  const [orders, setOrders] = useState<RentalOrder[]>([]);
  const [activeOrdersCount, setActiveOrdersCount] = useState(0);
  const [customers, setCustomers] = useState<UserProfile[]>([]);
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [config, setConfig] = useState<GlobalConfig | null>(null);
  const [editConfig, setEditConfig] = useState<GlobalConfig | null>(null);
  // apiConfig/logistics — every bike table from the project appendix. Edited on the
  // Settings tab, read by both apps and the Cloud Functions.
  const [logistics, setLogistics] = useState<LogisticsConfig | null>(null);
  const [editLogistics, setEditLogistics] = useState<LogisticsConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [supportThreads, setSupportThreads] = useState<Record<string, SupportMessage[]>>({});
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  // Server-maintained headline counts (stats/platformCounts) so nav badges and
  // totals don't depend on streaming whole collections. Null until first read.
  const [platformCounts, setPlatformCounts] = useState<PlatformCounts | null>(null);
  // Two-factor auth. `mfaResolver` is set mid-login when the account has TOTP
  // enrolled (user is NOT signed in until it resolves). `hasSecondFactor` gates
  // mandatory enrollment for the admin: null = unknown, false = must enroll.
  const [mfaResolver, setMfaResolver] = useState<MultiFactorResolver | null>(null);
  const [hasSecondFactor, setHasSecondFactor] = useState<boolean | null>(null);

  // Gate everything behind sign-in, then confirm the admin claim.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setMfaResolver(null); // sign-in (incl. any 2FA challenge) completed
        // enrolledFactors is available synchronously off the user record.
        try { setHasSecondFactor(multiFactor(currentUser).enrolledFactors.length > 0); }
        catch { setHasSecondFactor(false); }
        try {
          const tok = await currentUser.getIdTokenResult();
          setIsAdmin(!!tok.claims.admin);
        } catch {
          setIsAdmin(false);
        }
      } else {
        setIsAdmin(null);
        setHasSecondFactor(null);
        // Returning to the login screen — clear in-flight login state so the submit
        // button doesn't stay stuck on "Authenticating…" after sign-out.
        setLoggingIn(false);
        setLoginPassword('');
        setLoginError('');
      }
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  // Which tabs consume which heavy collections. The list listeners below attach
  // only while a consuming tab is open, instead of streaming every collection for
  // the whole session (the previous behavior). Gated on booleans (not activeTab
  // directly) so switching between two tabs that both need a collection doesn't
  // needlessly detach/reattach it.
  const needOrders = activeTab === 'analytics' || activeTab === 'users' || activeTab === 'bikes';
  const needCustomers = activeTab === 'users' || activeTab === 'licenses';
  const needProviders = activeTab === 'users';
  const needPerf = activeTab === 'analytics';

  // ── Always-on, cheap subscriptions (bounded queries + single docs) ──────────
  useEffect(() => {
    if (!user || !isAdmin) return;

    const unsubStats = onSnapshot(query(collection(db, 'stats'), orderBy('date', 'desc'), limit(30)), (snap) => {
      setDailyStats(snap.docs.map(d => d.data() as DailyStats));
    });

    // Server-maintained headline counts — drives the nav badges/totals without
    // needing the full users/orders collections in memory.
    const unsubCounts = onSnapshot(doc(db, 'stats', 'platformCounts'), (snap) => {
      setPlatformCounts(snap.exists() ? (snap.data() as PlatformCounts) : null);
    });

    const unsubConfig = subscribeToGlobalConfig((latest: GlobalConfig) => {
      setConfig(latest);
      setEditConfig(prev => prev ?? latest);
    });

    const unsubLogistics = onSnapshot(doc(db, 'apiConfig', 'logistics'), (snap) => {
      if (!snap.exists()) return;
      const latest = snap.data() as LogisticsConfig;
      setLogistics(latest);
      setEditLogistics(prev => prev ?? latest);
    });

    // Bound to the most recent messages instead of streaming the entire
    // (unbounded, ever-growing) supportMessages collection into the browser.
    // Ordered desc + limited, then iterated oldest→newest so each thread stays
    // in ascending order for display.
    const unsubSupport = onSnapshot(
      query(collection(db, 'supportMessages'), orderBy('timestamp', 'desc'), limit(500)),
      (snap) => {
        const threads: Record<string, SupportMessage[]> = {};
        [...snap.docs].reverse().forEach(docSnap => {
          const msg = { ...docSnap.data(), id: docSnap.id } as SupportMessage;
          if (!threads[msg.userPhone]) threads[msg.userPhone] = [];
          threads[msg.userPhone].push(msg);
        });
        setSupportThreads(threads);
        const unread = snap.docs.filter(d => {
          const m = d.data();
          return !m.isReadByAdmin && m.senderPhone !== 'admin' && m.senderPhone !== 'system';
        }).length;
        setChatUnreadCount(unread);
      }
    );

    return () => { unsubStats(); unsubCounts(); unsubConfig(); unsubLogistics(); unsubSupport(); };
  }, [user, isAdmin]);

  // ── Tab-scoped heavy list subscriptions ─────────────────────────────────────
  // Each attaches only while a tab that needs it is open. Last-loaded data is kept
  // when detached (no clearing) so tab switches don't flash empty.
  useEffect(() => {
    if (!user || !isAdmin || !needOrders) return;
    const unsub = onSnapshot(query(collection(db, 'orders')), (snap) => {
      const all = snap.docs.map(d => ({ ...d.data(), id: d.id } as RentalOrder));
      setOrders(all);
      setActiveOrdersCount(all.filter(o => !['delivered', 'cancelled'].includes(o.status)).length);
    });
    return unsub;
  }, [user, isAdmin, needOrders]);

  useEffect(() => {
    if (!user || !isAdmin || !needCustomers) return;
    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      setCustomers(snap.docs.map(d => d.data() as UserProfile));
    });
    return unsub;
  }, [user, isAdmin, needCustomers]);

  useEffect(() => {
    if (!user || !isAdmin || !needProviders) return;
    const unsub = onSnapshot(collection(db, 'providers'), (snap) => {
      setProviders(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ProviderProfile));
    });
    return unsub;
  }, [user, isAdmin, needProviders]);

  useEffect(() => {
    if (!user || !isAdmin || !needPerf) return;
    const unsub = onSnapshot(collection(db, 'providerPerformance'), (snap) => {
      setProviderPerf(snap.docs.map(d => d.data() as ProviderPerformance));
    });
    return unsub;
  }, [user, isAdmin, needPerf]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError('');
    try {
      await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
    } catch (err: any) {
      if (err?.code === 'auth/multi-factor-auth-required') {
        // Password was correct; a second factor is required. Hand the resolver to
        // the TOTP challenge screen — the user is not signed in until it verifies.
        setMfaResolver(getMultiFactorResolver(auth, err as MultiFactorError));
      } else {
        setLoginError('Invalid credentials. Access denied.');
      }
      setLoggingIn(false);
    }
  };

  const handleLogout = () => { signOut(auth).catch(() => alert('Failed to sign out. Please try again.')); };

  // Force-refresh the ID token and re-check the claim. A newly provisioned admin
  // claim only appears after a forced refresh, so this is the recovery path.
  const refreshAccess = async () => {
    const u = auth.currentUser;
    if (!u) { setIsAdmin(null); return; }
    try {
      const tok = await u.getIdTokenResult(true);
      setIsAdmin(!!tok.claims.admin);
    } catch {
      setIsAdmin(false);
    }
  };

  const handleToggleBlock = async (type: 'users' | 'providers', id: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(db, type, id), { isBlocked: !currentStatus });
    } catch {
      alert('Failed to update status.');
    }
  };

  // Dotted-path setter shared by both config editors ('stripe.secretKey',
  // 'delivery.startTime', …). Missing intermediate objects are auto-created.
  const setByPath = <T,>(base: T, field: string, value: any): T => {
    const next: any = { ...base };
    const parts = field.split('.');
    if (parts.length === 1) {
      next[field] = value;
      return next;
    }
    let current: any = next;
    for (let i = 0; i < parts.length - 1; i++) {
      if (current[parts[i]] == null || typeof current[parts[i]] !== 'object') current[parts[i]] = {};
      else current[parts[i]] = Array.isArray(current[parts[i]]) ? [...current[parts[i]]] : { ...current[parts[i]] };
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
    return next;
  };

  const handleChange = (field: string, value: any) => {
    if (!editConfig) return;
    setEditConfig(setByPath(editConfig, field, value));
  };

  const handleNumericChange = (field: string, value: string) => {
    const num = value === '' ? 0 : parseFloat(value);
    if (!isNaN(num)) handleChange(field, num);
  };

  const handleLogisticsChange = (field: string, value: any) => {
    if (!editLogistics) return;
    setEditLogistics(setByPath(editLogistics, field, value));
  };

  const handleSaveConfig = async () => {
    if (!editConfig) return;
    setSaving(true);
    setSaveError(null);
    try {
      // SECURITY: never write Stripe secrets to apiConfig/global — that doc is
      // client-readable. Secrets live only in the server-only apiConfigSecret/stripe
      // doc (read by the Cloud Functions admin SDK). Strip them from the payload so
      // the console can never (re)persist them into the browser-reachable config.
      // NOTE: any secret already inline in apiConfig/global must be migrated out of
      // it once (into apiConfigSecret/stripe) to fully close the exposure.
      const { secretKey, webSecret, ...safeStripe } = (editConfig.stripe as any) ?? {};
      const safeConfig = { ...editConfig, stripe: safeStripe };
      await updateDoc(doc(db, 'apiConfig', 'global'), safeConfig as any);
      if (editLogistics) {
        await updateDoc(doc(db, 'apiConfig', 'logistics'), {
          ...(editLogistics as any),
          updatedAt: new Date().toISOString(),
        });
      }
      alert('Configuration updated!');
    } catch (err: any) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSendAdminMessage = async (userPhone: string, text: string) => {
    const thread = supportThreads[userPhone];
    if (!thread || thread.length === 0) return;
    const firstMsg = thread[0];
    try {
      await addDoc(collection(db, 'supportMessages'), {
        userPhone,
        userName: firstMsg.userName,
        userRole: firstMsg.userRole,
        senderPhone: 'admin',
        // Tag the sender role so the onAdminReplyToSupport trigger reliably identifies
        // this as an admin reply and pushes a notification to the user.
        senderRole: 'admin',
        senderName: 'Admin',
        text,
        timestamp: new Date().toISOString(),
        isReadByAdmin: true,
      });
    } catch {
      // Surface the failure instead of a silent unhandled rejection.
      alert('Failed to send reply. Please try again.');
    }
  };

  const handleMarkRead = async (userPhone: string) => {
    const msgs = supportThreads[userPhone] || [];
    const unread = msgs.filter(m => !m.isReadByAdmin && m.senderPhone !== 'admin' && m.senderPhone !== 'system');
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    unread.forEach(msg => {
      if (msg.id) batch.update(doc(db, 'supportMessages', msg.id), { isReadByAdmin: true });
    });
    // Non-fatal: a failed mark-read shouldn't throw an unhandled rejection; the
    // unread flags simply remain and can be retried.
    await batch.commit().catch(() => { /* left unread; will retry on next view */ });
  };

  // Licenses awaiting a decision — drives the nav badge. Sourced from the
  // server-maintained aggregate (available on every tab) so it no longer needs the
  // full `customers` collection, which now only loads on the Users/Licenses tabs.
  // Falls back to the client-derived count when the aggregate doc isn't present yet
  // (e.g. before backfill) and customers happen to be loaded.
  const pendingLicenseCount = platformCounts?.pendingLicenses != null
    ? Math.max(0, platformCounts.pendingLicenses)
    : customers.filter(c => c.driverLicense?.frontPath && !c.driverLicense?.reviewedAt).length;

  // Active orders (not delivered/cancelled) from the aggregate, falling back to the
  // count derived from the orders listener when it's loaded / the doc is absent.
  const activeOrders = platformCounts?.ordersByStatus
    ? Math.max(0, (platformCounts.ordersTotal ?? 0)
        - (platformCounts.ordersByStatus.delivered ?? 0)
        - (platformCounts.ordersByStatus.cancelled ?? 0))
    : activeOrdersCount;

  if (authLoading) return (
    <div className="flex items-center justify-center min-h-screen bg-stone-100">
      <div className="text-center">
        <img src={`${process.env.PUBLIC_URL}/images/mainpage/splashscreen.png`} alt="Foodyzz" className="h-16 w-auto border-4 border-black shadow-brutalist inline-block mb-4" />
        <p className="font-black uppercase tracking-widest text-sm">Initializing...</p>
      </div>
    </div>
  );

  // Mid-login 2FA challenge — the user is not signed in until the code verifies.
  if (mfaResolver) return (
    <MfaChallenge
      resolver={mfaResolver}
      onCancel={() => { setMfaResolver(null); setLoginPassword(''); }}
    />
  );

  if (!user) return (
    <div className="flex items-center justify-center min-h-screen bg-stone-100">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src={`${process.env.PUBLIC_URL}/images/mainpage/splashscreen.png`} alt="Foodyzz" className="h-24 w-auto border-4 border-black shadow-brutalist inline-block mb-4" />
          <h1 className="font-black uppercase tracking-tighter text-2xl">Foodyzz Portal</h1>
          <p className="text-stone-500 text-xs font-mono uppercase mt-1">Admin Access Only</p>
        </div>
        <form onSubmit={handleLogin} className="bg-white border-4 border-black shadow-brutalist p-8 space-y-4">
          <div>
            <label className="font-black uppercase text-[10px] tracking-widest text-stone-500 block mb-1">Email</label>
            <input
              type="email"
              value={loginEmail}
              onChange={e => setLoginEmail(e.target.value)}
              required
              className="w-full border-2 border-black px-3 py-2 font-mono text-sm focus:outline-none focus:border-brand-green"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="font-black uppercase text-[10px] tracking-widest text-stone-500 block mb-1">Password</label>
            <input
              type="password"
              value={loginPassword}
              onChange={e => setLoginPassword(e.target.value)}
              required
              className="w-full border-2 border-black px-3 py-2 font-mono text-sm focus:outline-none focus:border-brand-green"
              placeholder="••••••••"
            />
          </div>
          {loginError && <p className="text-red-500 text-xs font-bold font-mono">{loginError}</p>}
          <button
            type="submit"
            disabled={loggingIn}
            className="w-full bg-black text-white font-black uppercase text-sm py-3 border-2 border-black shadow-brutalist hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all disabled:opacity-50"
          >
            {loggingIn ? 'Authenticating...' : 'Sign In →'}
          </button>
        </form>
      </div>
    </div>
  );

  if (isAdmin === null) return (
    <div className="flex items-center justify-center min-h-screen bg-stone-100">
      <p className="font-black uppercase tracking-widest text-sm">Loading…</p>
    </div>
  );

  if (!isAdmin) return (
    <div className="flex items-center justify-center min-h-screen bg-stone-100">
      <div className="bg-white border-4 border-black shadow-brutalist p-8 max-w-sm text-center">
        <h1 className="font-black uppercase text-xl mb-2">No Access</h1>
        <p className="text-stone-500 text-sm mb-4">This account does not have admin access to the Foodyzz portal.</p>
        <div className="space-y-2">
          <button onClick={refreshAccess} className="w-full font-black uppercase text-xs text-stone-500 hover:text-brand-green-dark py-2">
            Refresh access
          </button>
          <button onClick={handleLogout} className="w-full font-black uppercase text-xs text-rose-600 hover:underline py-1">Sign out</button>
        </div>
      </div>
    </div>
  );

  // Mandatory 2FA: the admin cannot reach the console without an enrolled second
  // factor. First login sets it up; every login after is challenged (above).
  if (hasSecondFactor === false) return (
    <MfaEnroll
      onEnrolled={() => setHasSecondFactor(true)}
      onSignOut={handleLogout}
    />
  );

  return (
    <div className="min-h-screen bg-stone-100 md:flex font-sans text-black">
      {/* Mobile top bar — logo + hamburger (hidden on md+) */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between bg-black text-white p-4 border-b-4 border-black">
        <div className="flex items-center gap-2">
          <img src={`${process.env.PUBLIC_URL}/images/mainpage/splashscreen.png`} alt="Foodyzz" className="h-8 w-auto rounded border-2 border-white shadow-[2px_2px_0px_0px_rgba(255,255,255,1)]" />
          <h1 className="font-black uppercase tracking-tighter text-lg leading-none">Admin Hub.</h1>
        </div>
        <button onClick={() => setMobileNavOpen((o) => !o)} aria-label="Toggle menu" className="p-2 -mr-2">
          {mobileNavOpen ? <X size={24}/> : <Menu size={24}/>}
        </button>
      </div>

      {/* Side Command Bar — sidebar on md+, collapsible drawer on mobile */}
      <nav className={`${mobileNavOpen ? 'flex' : 'hidden'} md:flex w-full md:w-64 md:shrink-0 bg-black text-white p-6 flex-col justify-between border-b-4 md:border-b-0 md:border-r-4 border-black`}>
        <div>
          <div className="hidden md:flex items-center gap-3 mb-12">
            <img src={`${process.env.PUBLIC_URL}/images/mainpage/splashscreen.png`} alt="Foodyzz" className="h-12 w-auto rounded border-2 border-white shadow-[2px_2px_0px_0px_rgba(255,255,255,1)]" />
            <h1 className="font-black uppercase tracking-tighter text-xl leading-none">Admin<br/>Hub.</h1>
          </div>

          <div className="space-y-2 md:space-y-4">
            {([
              { key: 'analytics' as const, icon: <BarChart3 size={18}/>, label: 'Insights' },
              { key: 'users'     as const, icon: <Users size={18}/>,    label: 'Customers' },
              { key: 'ops'       as const, icon: <LayoutDashboard size={18}/>, label: 'Rentals' },
              { key: 'bikes'     as const, icon: <Bike size={18}/>, label: 'Bikes' },
              { key: 'licenses'  as const, icon: <Contact size={18}/>, label: 'Licenses', badge: pendingLicenseCount },
              { key: 'chat'      as const, icon: <MessageSquare size={18}/>, label: 'Chat Manager', badge: chatUnreadCount },
              { key: 'settings'  as const, icon: <Settings size={18}/>, label: 'Settings' },
            ]).map(({ key, icon, label, badge }) => (
              <button
                key={key}
                onClick={() => { setActiveTab(key); setMobileNavOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 font-black uppercase text-xs tracking-widest transition-all ${activeTab === key ? 'bg-brand-green text-black shadow-brutalist border-2 border-white' : 'text-stone-400 hover:text-white'}`}
              >
                {icon} {label}
                {badge != null && badge > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">{badge > 9 ? '9+' : badge}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <button onClick={handleLogout} className="mt-6 md:mt-0 flex items-center gap-3 px-4 py-3 font-black uppercase text-xs text-stone-500 hover:text-rose-500 transition-colors">
          <LogOut size={18}/> Exit System
        </button>
      </nav>

      {/* Main Terminal View */}
      <main className="flex-1 min-w-0 p-4 md:p-8 overflow-y-auto">
        <Suspense fallback={<div className="font-black uppercase tracking-widest text-sm text-stone-400 p-4">Loading…</div>}>
        {activeTab === 'analytics' && (
          <AnalyticsTab dailyStats={dailyStats} providerPerf={providerPerf} ordersCount={activeOrders} orders={orders} />
        )}
        {activeTab === 'users' && (
          <UserManagementTab customers={customers} providers={providers} orders={orders} config={config} handleToggleBlock={handleToggleBlock} />
        )}
        {activeTab === 'ops' && <OperationsTab logistics={logistics} />}
        {activeTab === 'bikes' && <BikesTab logistics={logistics} orders={orders} />}
        {activeTab === 'licenses' && <LicensesTab customers={customers} />}
        {activeTab === 'chat' && (
          <ChatManagerTab
            supportThreads={supportThreads}
            onSendReply={handleSendAdminMessage}
            onMarkRead={handleMarkRead}
          />
        )}
        {activeTab === 'settings' && editConfig && (
          <GlobalConfigTab
            editConfig={editConfig}
            editLogistics={editLogistics}
            handleChange={handleChange}
            handleNumericChange={handleNumericChange}
            handleLogisticsChange={handleLogisticsChange}
            handleSave={handleSaveConfig}
            saving={saving}
            error={saveError}
          />
        )}
        </Suspense>
      </main>
    </div>
  );
}
