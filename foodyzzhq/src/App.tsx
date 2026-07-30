import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, ActivityIndicator, Text, AppState, Platform } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { StripeProvider } from '@stripe/stripe-react-native';
import {
  useFonts,
  Inter_400Regular,
  Inter_700Bold,
  Inter_900Black
} from '@expo-google-fonts/inter';
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

// Firebase initialization and Auth state
import {
  auth, db, saveProviderFcmToken, onAuthStateChanged, signOutClean, signOutColdStart,
  getActiveProviderId, setActiveProviderId, releaseProviderDevice, listMyStores,
  syncAdminClaim, runWithRetry,
} from './services/firebase';
import { playNotificationSound, stopCurrentSound, SOUND_NAMES } from './services/soundPlayer';
import type { FirebaseAuthTypes } from '@react-native-firebase/auth';

// Navigation and Screens
import ProviderNavigator from './navigation/ProviderNavigator';
import AuthScreen from './screens/AuthScreen'; // Assuming a similar auth flow for providers
import ProviderOnboardingWizard from './screens/ProviderOnboardingWizard';
import { ActiveStoreContext } from './contexts/ActiveStoreContext';
import ErrorBoundary from './components/ErrorBoundary';

// Global navigation reference for deep-linking
const navigationRef = createNavigationContainerRef<any>();

// Configure foreground notification behavior
// shouldPlaySound is false because we handle sound manually via expo-av
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // SDK 53 (expo-notifications 0.31) split shouldShowAlert into banner + list.
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync().catch(() => {
  // Splash screen already hidden or couldn't be controlled, continue
});

export default function App() {
  const [user, setUser] = useState<FirebaseAuthTypes.User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [stripeKey, setStripeKey] = useState('');
  // Document id of the active store; doubles as a re-mount key for the provider
  // UI so a store switch forces every screen to re-read getActiveProviderId().
  // It is the id itself, not the zip suffix: a store's id names whoever CREATED
  // it, and a member operating someone else's store cannot recompose it from
  // their own phone.
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null);

  // Load fonts as defined in tailwind.config.js aliases
  const [fontsLoaded, fontError] = useFonts({
    'Inter': Inter_400Regular,
    'Inter-Bold': Inter_700Bold,
    'Inter-Black': Inter_900Black,
    'SpaceGrotesk-Bold': SpaceGrotesk_700Bold,
    'JetBrainsMono-Regular': JetBrainsMono_400Regular,
  });
  // Fonts are non-critical: a slow or failed load must never brick the app on the
  // loading screen. Proceed on error, or after a grace period if useFonts silently
  // never resolves (seen when an asset host/Metro stalls) — text just falls back to the
  // system font. The happy path is unaffected: fontsLoaded flips true well under 1s.
  const [fontWaitElapsed, setFontWaitElapsed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFontWaitElapsed(true), 6000);
    return () => clearTimeout(t);
  }, []);
  const fontsReady = fontsLoaded || !!fontError || fontWaitElapsed;
  useEffect(() => {
    if (__DEV__ && (fontError || (fontWaitElapsed && !fontsLoaded))) {
      console.warn('[fonts] proceeding without custom fonts:', fontError ? String(fontError) : 'load timed out');
    }
  }, [fontError, fontWaitElapsed, fontsLoaded]);

  useEffect(() => {
    const unsub = db.collection('apiConfig').doc('global').onSnapshot(
      (snap) => { const key = snap.data()?.stripe?.publishableKey; if (key) setStripeKey(key); },
      () => {}
    );
    return unsub;
  }, []);

  // Watch the active store's onboarded flag to gate the wizard. Keyed on the store
  // document id so switching stores re-subscribes to the right doc. Driven by the
  // auth-state change below, so every login re-evaluates for the freshly-stored id.
  const onboardListenerRef = useRef<(() => void) | null>(null);
  const onboardProviderIdRef = useRef<string | null>(null);
  // Generation counter: this function awaits (storage, and sometimes a network
  // membership lookup), and it is re-entered on every auth event. Without it two
  // overlapping runs could each attach a snapshot listener and only the last would
  // be tracked in the ref — leaking the earlier one for the life of the process.
  const subscribeGenRef = useRef(0);
  const subscribeOnboarded = useCallback(async () => {
    const gen = ++subscribeGenRef.current;
    const superseded = () => gen !== subscribeGenRef.current;
    const teardown = () => {
      if (onboardListenerRef.current) { onboardListenerRef.current(); onboardListenerRef.current = null; }
    };

    const currentUser = auth().currentUser;
    if (!currentUser) {
      teardown();
      onboardProviderIdRef.current = null;
      setActiveStoreId(null);
      setOnboarded(null); setProfileReady(false);
      return;
    }
    const cleanPhone = currentUser.phoneNumber?.replace(/\D/g, '') || currentUser.email?.split('@')[0] || '';
    let providerId = await getActiveProviderId();

    // Signed in but no store on the device — the reinstall case (the Firebase
    // Keychain session survives an app delete while AsyncStorage is wiped). We
    // used to sign out here, because the store could only be recomposed from a
    // zip we no longer had. Memberships are now server-side, so ask: one store
    // is adopted silently, and the user is spared a pointless re-verification.
    if (!providerId && cleanPhone) {
      const stores = await runWithRetry(() => listMyStores()).catch(() => null);
      if (superseded()) return;
      if (stores && stores.length > 0) {
        // Deterministic pick; a member of several stores can change it from
        // Account → Switch, which persists the choice.
        providerId = [...stores].sort((a, b) => a.id.localeCompare(b.id))[0].id;
        await setActiveProviderId(providerId);
      }
    }
    if (superseded()) return;

    // Already watching this exact store — don't tear down (avoids a spinner flash on
    // token refresh, which also fires onAuthStateChanged).
    if (providerId === onboardProviderIdRef.current && onboardListenerRef.current) return;

    teardown();
    onboardProviderIdRef.current = providerId;
    setActiveStoreId(providerId);
    if (__DEV__) console.log('[ONBOARD] subscribe -> providers/', providerId);
    if (!providerId) {
      // Authed, but this phone belongs to no store (and the lookup didn't fail
      // transiently). Falling through would falsely render onboarding, so sign out
      // and let AuthScreen collect a phone + invite code.
      // Cold-start sign-out: plain signOut without Firestore teardown. Calling
      // db.terminate() here would race the app-level apiConfig listener and crash
      // natively (FIRIllegalStateException) — see signOutColdStart.
      if (cleanPhone) { signOutColdStart().catch(() => {}); return; }
      setOnboarded(false); setProfileReady(true); return;
    }

    // New store: reset until its snapshot resolves so a previous store's onboarded
    // flag can't keep rendering the dashboard for a not-yet-onboarded store.
    setOnboarded(null); setProfileReady(false);
    onboardListenerRef.current = db.collection('providers').doc(providerId!).onSnapshot((snap) => {
      const val = snap?.exists ? (snap.data()?.onboarded ?? false) : false;
      if (__DEV__) console.log('[ONBOARD] snapshot', providerId, 'onboarded=', val);
      setOnboarded(val);
      setProfileReady(true);
    }, (err) => {
      // Permission-denied fires transiently right after logout while the listener is
      // torn down; treat any error as "not ready" rather than surfacing onboarded.
      if (__DEV__) console.log('[ONBOARD] listener error', err?.message);
      setOnboarded(false); setProfileReady(true);
    });
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged((authenticatedUser) => {
      // Orphaned session guard: a provider is identified by phone or email, so a
      // signed-in user with neither is an unusable leftover (e.g. a Keychain
      // session surviving an app delete). Sign out so the listener re-fires with
      // null and routes back to AuthScreen, rather than stranding the user.
      if (authenticatedUser && !authenticatedUser.phoneNumber && !authenticatedUser.email) {
        console.warn('Auth user has no phone or email — signing out orphaned session');
        // Cold-start sign-out (no Firestore teardown) — see signOutColdStart.
        signOutColdStart().catch(() => {});
        return;
      }
      setUser(authenticatedUser);
      if (initializing) setInitializing(false);
      // Pull the staff `admin` claim onto this token before any screen reads a
      // customer's identity documents — Storage rules gate those on the claim.
      // Fire-and-forget: it self-guards against the re-entry its own token refresh
      // causes, and a failure only costs a retry on the next auth event.
      if (authenticatedUser) syncAdminClaim().catch(() => {});
      // Re-evaluate onboarding for whatever store is now active (login, logout, switch).
      subscribeOnboarded();
    });
    return () => { unsubscribe(); if (onboardListenerRef.current) onboardListenerRef.current(); };
  }, [subscribeOnboarded]);

  // Switch the active store without logging out — between stores you own, or
  // stores you were invited to. Persist the new id, then re-subscribe onboarding
  // for the target store; the activeStoreId change re-keys ProviderNavigator so
  // all screens re-scope.
  const switchStore = useCallback(async (providerId: string) => {
    // Hand this device's push token to the store being switched TO. Without the
    // release the old store keeps alerting a device that is no longer watching it
    // — which for a shared store means notifying someone else's staff.
    const previous = await getActiveProviderId();
    if (previous && previous !== providerId) await releaseProviderDevice(previous);
    await setActiveProviderId(providerId);
    setActiveStoreId(providerId);
    await subscribeOnboarded();
  }, [subscribeOnboarded]);

  // Android 8+ ties a notification's sound to its channel (the push payload's
  // `sound` is ignored). Register one HIGH-importance channel per sound so a
  // background/killed push can play the provider's chosen sound — the server
  // routes each push to `order_<sound>` (see functions sendExpoPush).
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    (async () => {
      try {
        for (const name of SOUND_NAMES) {
          await Notifications.setNotificationChannelAsync(`order_${name}`, {
            name: `Orders · ${name}`,
            importance: Notifications.AndroidImportance.HIGH,
            sound: `${name}.mp3`, // raw resource bundled via app.json plugin
            vibrationPattern: [0, 250, 250, 250],
            enableVibrate: true,
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
          });
        }
        // Silent channel for providers who turned notification sound off.
        await Notifications.setNotificationChannelAsync('order_silent', {
          name: 'Orders · silent',
          importance: Notifications.AndroidImportance.HIGH,
          sound: null,
          enableVibrate: true,
          vibrationPattern: [0, 250, 250, 250],
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        });
      } catch (e: any) {
        console.warn('Failed to register notification channels:', e?.message);
      }
    })();
  }, []);

  // Handle push notification permissions and token saving. Keyed on the ACTIVE
  // STORE as well as the user: the token is registered against a store's device
  // list, so switching stores must re-register against the new one.
  useEffect(() => {
    if (!user || !activeStoreId) return;
    let cancelled = false;
    const registerForPushNotificationsAsync = async () => {
      try {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted' || cancelled) return;
        // Physical devices / standalone builds don't auto-inject the projectId
        // (unlike Expo Go), so getExpoPushTokenAsync() fails silently and no
        // token is saved. Pass it explicitly from app config.
        const projectId =
          Constants.expoConfig?.extra?.eas?.projectId ??
          (Constants as any).easConfig?.projectId;
        const token = (await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined
        )).data;
        if (cancelled) return;
        await saveProviderFcmToken(activeStoreId, token);
      } catch (e: any) {
        console.warn('Push notification setup skipped:', e?.message);
      }
    };
    registerForPushNotificationsAsync();
    return () => { cancelled = true; };
  }, [user, activeStoreId]);

  useEffect(() => {
    // Listener for notification taps
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;

      if (navigationRef.isReady()) {
        if (data.type === 'NEW_CUSTOMER_MESSAGE' && data.orderId) {
          // Order chat → that order's thread.
          navigationRef.navigate('Chat', { orderId: data.orderId });
        } else if (data.type === 'NEW_CUSTOMER_SUPPORT_MESSAGE' || data.type === 'NEW_PROVIDER_SUPPORT_MESSAGE') {
          // General chat → the Chat Center, opened on that person's thread.
          navigationRef.navigate('Main', { screen: 'HQChat', params: { openPhone: data.userPhone } });
        } else if (data.type === 'ID_DOCS_UPLOADED') {
          // The customer just sent their documents — Dispatch is where the accepted
          // order card (and its CustomerIdCard review panel) lives.
          navigationRef.navigate('Dispatch');
        } else if (data.type === 'BROADCAST_ORDER' || data.type === 'DIRECT_ORDER' || data.type === 'ORDER_CANCELLED') {
          navigationRef.navigate('Dispatch');
        } else if (data.type === 'DAILY_PROMO_SUMMARY') {
          navigationRef.navigate('Promos'); // No specific promoId for summary
        } else if (data.type === 'PROMO_DEACTIVATED' && data.promoId) {
          navigationRef.navigate('Promos', { promoId: data.promoId }); // Pass promoId for specific highlight
        } else if (data.type === 'ADMIN_SUPPORT_REPLY') {
          navigationRef.navigate('Support');
        }
      }
    });

    return () => subscription.remove();
  }, []);

  // Play custom sound for foreground order notifications
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener(notification => {
      const data = notification.request.content.data as { type?: string };
      if (data.type === 'BROADCAST_ORDER' || data.type === 'DIRECT_ORDER') {
        playNotificationSound(); // dispatch keeps the provider's chosen sound (AsyncStorage)
      } else if (data.type) {
        playNotificationSound('quicktone'); // every other alert: standard quicktone
      }
    });
    return () => subscription.remove();
  }, []);

  // Stop any playing sound when app goes to background
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        stopCurrentSound();
      }
    });
    return () => sub.remove();
  }, []);

  // App-icon badge: the server bumps a per-store unread count on each push so the
  // icon reminds the provider of new orders/messages while the app is closed.
  // Clear it — both the OS badge and the active provider doc — whenever they
  // open/foreground the app, scoped to the active store.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const clearBadge = async () => {
      Notifications.setBadgeCountAsync(0).catch(() => {});
      const id = await getActiveProviderId();
      if (!cancelled && id) db.collection('providers').doc(id).update({ badgeCount: 0 }).catch(() => {});
    };
    clearBadge(); // cold launch / sign-in
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') clearBadge(); });
    return () => { cancelled = true; sub.remove(); };
  }, [user, activeStoreId]);

  // Hide splash screen when fonts are ready (loaded, errored, or timed out) and auth is initialized
  useEffect(() => {
    if (fontsReady && !initializing) {
      SplashScreen.hideAsync();
    }
  }, [fontsReady, initializing]);

  // Loading state fallback
  if (!fontsReady || initializing) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' }}>
        <ActivityIndicator size="large" color="#507425" />
        <View style={{ marginTop: 20, padding: 20, backgroundColor: 'white', borderRadius: 12, borderWidth: 2, borderColor: '#000000' }}>
          <Text style={{ color: '#000000', fontSize: 16, fontWeight: 'bold' }}>Loading Node...</Text>
          <Text style={{ color: '#000', marginTop: 10 }}>Fonts: {fontsLoaded ? '✓' : '⏳'}</Text>
          <Text style={{ color: '#000' }}>Auth: {initializing ? '⏳' : '✓'}</Text>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      {/* Edge-to-edge is mandatory from Android 16 / targetSdk 36, so the status
          bar is always translucent and `backgroundColor`/`translucent` are no-ops
          that warn at runtime. Only the icon style is still ours to set; each
          screen paints its own background up under the bar via the top inset. */}
      <StatusBar style="light" />
      <StripeProvider publishableKey={stripeKey || 'pk_test_placeholder'} key={stripeKey}>
        <ActiveStoreContext.Provider value={{ switchStore }}>
          {/* Catch render errors anywhere in the navigation tree and show a
              recoverable fallback instead of crashing the whole app. */}
          <ErrorBoundary>
          <NavigationContainer ref={navigationRef}>
            {!user ? (
              <AuthScreen onAuthenticated={(u) => setUser(u)} />
            ) : !profileReady ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#020617' }}>
                <ActivityIndicator size="large" color="#507425" />
              </View>
            ) : onboarded === true ? (
              <ProviderNavigator key={activeStoreId ?? 'default'} />
            ) : (
              <ProviderOnboardingWizard user={user} onComplete={subscribeOnboarded} />
            )}
          </NavigationContainer>
          </ErrorBoundary>
        </ActiveStoreContext.Provider>
      </StripeProvider>
    </SafeAreaProvider>
  );
}
