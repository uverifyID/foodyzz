import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, Text, AppState, Platform } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
import { StripeProvider } from '@stripe/stripe-react-native';

// Firebase initialization and Auth state
import { db, saveFcmToken, onAuthStateChanged, signOutClean } from './services/firebase';
import { playNotificationSound, stopCurrentSound, SOUND_NAMES } from './services/soundPlayer';
import type { FirebaseAuthTypes } from '@react-native-firebase/auth';

// Navigation and Screens
import AppNavigator from './navigation/AppNavigator';
import AuthScreen from './screens/AuthScreen';
import OnboardingWizard from './screens/OnboardingWizard';
import ErrorBoundary from './components/ErrorBoundary';
import { UserProfileProvider, useUserProfile } from './context/UserProfileContext';
import { StripeReadyContext } from './context/StripeReadyContext';

// Global navigation reference for deep-linking outside of component context (e.g., from notifications)
const navigationRef = createNavigationContainerRef<any>();

// Fallback the StripeProvider mounts with until the real publishable key is fetched
// from Firestore. Payment UI is gated (via StripeReadyContext) so nothing ever
// charges/authorizes against this placeholder.
const STRIPE_PLACEHOLDER_KEY = 'pk_test_placeholder';

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
  const [manualLogin, setManualLogin] = useState(false);
  const [stripeKey, setStripeKey] = useState<string | null>(null);

  // Diagnostic mount log
  useEffect(() => {
    if (__DEV__) console.log('🚀 Customer App component mounted');
  }, []);

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
  // system font. The happy path is unaffected: fontsLoaded flips true well under 1s,
  // so fontsReady is true long before this timeout fires.
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

  // Debug logging for startup sequence
  useEffect(() => {
    if (__DEV__) console.log('🔍 App State:', { fontsLoaded, initializing, user: user?.phoneNumber || 'none' });
  }, [fontsLoaded, initializing, user]);

  useEffect(() => {
    if (__DEV__) console.log('🔥 Setting up Firebase auth listener...');
    // Subscribe to Firebase Auth changes
    const unsubscribe = onAuthStateChanged((authenticatedUser) => {
      if (__DEV__) console.log('🔥 Auth state changed:', authenticatedUser ? 'User logged in' : 'No user');
      // Orphaned session guard: this app authenticates by phone, so a signed-in
      // user with no phoneNumber is an unusable leftover (e.g. a Keychain session
      // surviving an app delete). Sign out so the listener re-fires with null and
      // routes back to AuthScreen, rather than stranding the user downstream.
      if (authenticatedUser && !authenticatedUser.phoneNumber) {
        console.warn('🔥 Auth user has no phoneNumber — signing out orphaned session');
        signOutClean().catch(() => {});
        return;
      }
      setUser(authenticatedUser);
      if (initializing) setInitializing(false);
    });

    return unsubscribe;
  }, [initializing]);

  // The authenticated user's profile is now subscribed to exactly once by
  // UserProfileProvider (see AuthedApp below) instead of by a per-screen listener.

  // Android 8+ ties a notification's sound to its channel (the push payload's
  // `sound` is ignored). Register one HIGH-importance channel per sound so a
  // background/killed push can play a custom sound — the server routes each push
  // to `order_<sound>` (sound chosen by notification type for customers).
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    (async () => {
      try {
        for (const name of SOUND_NAMES) {
          await Notifications.setNotificationChannelAsync(`order_${name}`, {
            name: `Updates · ${name}`,
            importance: Notifications.AndroidImportance.HIGH,
            sound: `${name}.mp3`, // raw resource bundled via app.json plugin
            vibrationPattern: [0, 250, 250, 250],
            enableVibrate: true,
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
          });
        }
        // Silent channel for customers who turned notification sound off.
        await Notifications.setNotificationChannelAsync('order_silent', {
          name: 'Updates · silent',
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

  // Handle push notification permissions and token saving
  useEffect(() => {
    if (user) {
      const registerForPushNotificationsAsync = async () => {
        try {
          const { status: existingStatus } = await Notifications.getPermissionsAsync();
          let finalStatus = existingStatus;
          if (existingStatus !== 'granted') {
            const { status } = await Notifications.requestPermissionsAsync();
            finalStatus = status;
          }
          if (finalStatus === 'granted') {
            // On a physical device / standalone build the projectId is NOT auto-
            // injected the way it is in Expo Go, so getExpoPushTokenAsync() fails
            // silently and no token is saved. Pass it explicitly from app config.
            const projectId =
              Constants.expoConfig?.extra?.eas?.projectId ??
              (Constants as any).easConfig?.projectId;
            const tokenResponse = await Notifications.getExpoPushTokenAsync(
              projectId ? { projectId } : undefined
            );
            await saveFcmToken(user.phoneNumber!, tokenResponse.data);
          } else {
            // Surfaces the most common silent cause: the OS notification prompt
            // was denied, so no token is ever fetched or saved.
            console.warn(`Push notifications not granted (status: ${finalStatus}); FCM token not saved.`);
          }
        } catch (err) {
          console.warn('Push notification registration failed:', err);
        }
      };
      registerForPushNotificationsAsync();
    }
  }, [user]);

  useEffect(() => {
    // Listener for when a user interacts with a notification (taps it)
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;

      if (navigationRef.isReady()) {
        if (data.type === 'NEW_PROVIDER_MESSAGE' || data.type === 'ADMIN_SUPPORT_REPLY') {
          // All customer↔FoodyzzHQ chat lives in the Chat tab now (single thread).
          navigationRef.navigate('Main', { screen: 'Chat' });
        } else if (data.type === 'ORDER_DELIVERED' && data.orderId) {
          // Open the delivered order's detail so the customer can rate + tip.
          navigationRef.navigate('Main', { screen: 'My Rentals', params: { focusOrderId: data.orderId } });
        } else if (data.orderId) {
          // Deep-link to the "My Rentals" tab for status updates or cancellations
          navigationRef.navigate('Main', { screen: 'My Rentals' });
        }
      }
    });

    return () => subscription.remove();
  }, []);

  // Play custom sound for foreground order notifications
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener(notification => {
      const data = notification.request.content.data as { type?: string };
      // Quicktone is the standard alert sound for every customer notification.
      if (data.type === 'ORDER_CONFIRMED' || data.type === 'ORDER_CANCELLED' || data.type === 'PRICE_ADJUSTED') {
        playNotificationSound('quicktone');
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

  // App-icon badge: the server bumps a per-user unread count on each push so the
  // icon reminds the customer of activity while the app is closed. Clear it —
  // both the OS badge and the user doc — whenever they open/foreground the app,
  // so the next count starts fresh from notifications they haven't seen.
  useEffect(() => {
    const phone = user?.phoneNumber;
    if (!phone) return;
    const clearBadge = () => {
      Notifications.setBadgeCountAsync(0).catch(() => {});
      db.collection('users').doc(phone).update({ badgeCount: 0 }).catch(() => {});
    };
    clearBadge(); // cold launch / sign-in
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') clearBadge(); });
    return () => sub.remove();
  }, [user]);

  // Fetch the Stripe publishable key from Firestore config (only when authenticated)
  useEffect(() => {
    if (!user) return;
    const unsub = db.collection('apiConfig').doc('global').onSnapshot(
      (snap) => {
        const key = snap.data()?.stripe?.publishableKey;
        if (key) setStripeKey(key);
      },
      (err) => console.error('Stripe Key fetch error:', err)
    );
    return unsub;
  }, [user]);

  // Hide splash screen when fonts are ready (loaded, errored, or timed out) and auth is initialized
  useEffect(() => {
    if (fontsReady && !initializing) {
      SplashScreen.hideAsync();
    }
  }, [fontsReady, initializing]);

  // Loading state fallback
  if (!fontsReady || initializing) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#507425' }}>
        <ActivityIndicator size="large" color="#FFFFFF" />
        <View style={{ marginTop: 20, padding: 20, backgroundColor: 'white', borderRadius: 10 }}>
          <Text style={{ color: '#507425', fontSize: 16, fontWeight: 'bold' }}>Initialising Node...</Text>
          <Text style={{ color: '#000', marginTop: 10 }}>Fonts: {fontsLoaded ? '✓' : '⏳'}</Text>
          <Text style={{ color: '#000' }}>Auth: {initializing ? '⏳' : '✓'}</Text>
        </View>
      </View>
    );
  }

  // Payment UI must stay disabled until the real publishable key has replaced the
  // placeholder the StripeProvider mounts with — otherwise a checkout could open
  // against "pk_test_placeholder" during the (usually sub-second) fetch window.
  const stripeReady = !!stripeKey && stripeKey !== STRIPE_PLACEHOLDER_KEY;

  return (
    <SafeAreaProvider>
      <StripeProvider
        publishableKey={stripeKey || STRIPE_PLACEHOLDER_KEY}
        // The key prop forces re-initialization once the real publishableKey is fetched from Firestore
        key={stripeKey}
      >
      <StripeReadyContext.Provider value={stripeReady}>
      <NavigationContainer ref={navigationRef}>
        {/* Catch render errors in the whole navigation tree and show a recoverable fallback. */}
        <ErrorBoundary>
        {/* Conditional rendering based on auth + onboarding state */}
        {!user ? (
          <AuthScreen onAuthenticated={(u) => {
            setUser(u);
            setManualLogin(true); // Flag to trigger redirect once navigator mounts
          }} />
        ) : (
          // Single users/{phone} subscription for the whole authenticated tree.
          <UserProfileProvider phone={user.phoneNumber}>
            <AuthedApp
              user={user}
              manualLogin={manualLogin}
              onManualLoginHandled={() => setManualLogin(false)}
            />
          </UserProfileProvider>
        )}
        </ErrorBoundary>
      </NavigationContainer>
      </StripeReadyContext.Provider>
      </StripeProvider>
    </SafeAreaProvider>
  );
}

// Authenticated subtree: consumes the shared profile (via useUserProfile) to gate
// onboarding and route freshly-onboarded users. Lives below UserProfileProvider so
// it reads the SAME single listener the tab screens do.
function AuthedApp({
  user,
  manualLogin,
  onManualLoginHandled,
}: {
  user: FirebaseAuthTypes.User;
  manualLogin: boolean;
  onManualLoginHandled: () => void;
}) {
  const { profile, loading } = useUserProfile();
  // `!loading` reproduces the old `profileReady` gate: don't flash the main app (or
  // the wizard with empty prefill) before the profile's first snapshot resolves.
  const profileReady = !loading;

  // Redirect logic after manual authentication. Only fires once the profile is
  // onboarded and the main navigator is mounted (the wizard has no routes).
  useEffect(() => {
    if (manualLogin && profile?.onboarded === true && navigationRef.isReady()) {
      if (__DEV__) console.log('🔥 Manual login detected, navigating to Explore...');
      // Route freshly-onboarded users to the Explore tab.
      navigationRef.navigate('Main', { screen: 'Explore' });
      onManualLoginHandled();
    }
  }, [manualLogin, profile, onManualLoginHandled]);

  if (!profileReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' }}>
        <ActivityIndicator size="large" color="#507425" />
      </View>
    );
  }

  return profile?.onboarded === true ? (
    <AppNavigator />
  ) : (
    <OnboardingWizard user={user} profile={profile} />
  );
}
