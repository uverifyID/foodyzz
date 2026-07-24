import React, { useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MapPin, ChevronRight, Copy, Check, Zap } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { COLORS, LAYOUT } from '../theme';
import { styled } from 'nativewind';
import { useNavigation } from '@react-navigation/native';
import { db, subscribeToGlobalConfig } from '../services/firebase';
import firebase from '@react-native-firebase/app';
import '@react-native-firebase/functions';
import authNative from '@react-native-firebase/auth';
import { UserProfile, GlobalConfig } from '../types';
import { geocodeZip, geocodeAddress, haversineMiles, extractZip, Coords } from '../services/geo';
import { useUserProfile } from '../context/UserProfileContext';

const DEFAULT_RADIUS = 10;

const StyledTouchableOpacity = styled(TouchableOpacity);

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const [providers, setProviders] = useState<any[]>([]);
  const [promos, setPromos] = useState<any[]>([]);
  const [providersWithDistance, setProvidersWithDistance] = useState<any[]>([]);
  const [config, setConfig] = useState<GlobalConfig | null>(null);
  // Current-user profile now comes from the shared single listener (UserProfileContext)
  // instead of a duplicate per-screen users/{phone} onSnapshot.
  const { profile: currentUserProfile, loading } = useUserProfile();
  const userName = currentUserProfile?.name || "Customer"; // Dynamically get user name

  const [copiedPromoId, setCopiedPromoId] = useState<string | null>(null);
  // Holds the "copied" reset timer so it can be cleared on unmount (mirrors the
  // debounce cleanup in AddressAutocomplete) — otherwise it fires setState on an
  // unmounted component if the screen is left within the 2s window.
  const copiedResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (copiedResetRef.current) clearTimeout(copiedResetRef.current);
    };
  }, []);

  // Session tracking to avoid double-counting views during a single app session
  const viewedPromos = useRef(new Set<string>());

  // Visibility Config: Item is "visible" when 50% of it is shown for at least 500ms
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
    minimumViewTime: 500,
  }).current;

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    viewableItems.forEach(({ item }: { item: any }) => {
      // If the item is a promo and hasn't been viewed this session
      if (item.promoId && !viewedPromos.current.has(item.promoId)) {
        viewedPromos.current.add(item.promoId);
        const incrementPromoViewsCall = firebase.app().functions('us-central1').httpsCallable('incrementPromoViews');
        incrementPromoViewsCall({ promoId: item.promoId }).catch(err =>
          console.error("Failed to log view:", err)
        );
      }
    });
  }).current;

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTitle: () => (
        <View>
          <Text className="text-xl font-black text-black uppercase tracking-tighter leading-none">
            Ride.<Text className="text-brand-green-dark">Now.</Text>
          </Text>
        </View>
      ),
      headerTitleAlign: 'left',
      headerStyle: { elevation: 0, shadowOpacity: 0, borderBottomWidth: 0, backgroundColor: 'white' },
    });
  }, [navigation]);

  // 1. Real-time listener for providers.
  // Only onboarded providers are orderable (non-onboarded stores have no pricing/
  // hours/bank set up), so filter server-side: same providers the customer can
  // actually use, fewer reads as the provider base grows. Served by the
  // providers(onboarded, zipCode) index.
  useEffect(() => {
    const unsubProviders = db.collection('providers')
      .where('onboarded', '==', true)
      // Cap the stream as the provider base grows (defensive read bound).
      .limit(200)
      .onSnapshot((snap) => {
        if (!snap) return;
        setProviders(snap.docs.map(d => ({ id: d.id, ...d.data() } as any)));
      }, (err) => console.error("Provider Sync Error:", err));

    return () => unsubProviders();
  }, []);

  // 2. Real-time listener for promos.
  // The carousel already discards inactive promos client-side (see
  // promoCarouselItems), so filtering isActive server-side yields the identical
  // result with fewer reads.
  useEffect(() => {
    const unsubPromos = db.collection('promos')
      .where('isActive', '==', true)
      .onSnapshot((snap) => {
        if (!snap) return;
        setPromos(snap.docs.map(d => ({ id: d.id, ...d.data() } as any)));
      }, (err) => console.error("Promo Sync Error:", err));

    return () => unsubPromos();
  }, []);

  // 3. Current user profile is provided by UserProfileContext (see useUserProfile above).

  // 5. Load global config (Google Maps key + broadcast radius for promo reach fallback).
  useEffect(() => {
    const unsub = subscribeToGlobalConfig((cfg: GlobalConfig) => {
      setConfig(cfg);
    });
    return unsub;
  }, []);

  // Per-provider distance memo. A provider snapshot produces a brand-new `providers`
  // array on ANY field change, which re-runs the effect below; without this cache
  // every such change re-geocodes every provider. Keyed on the inputs distance
  // actually depends on: provider id + address/zip, scoped to the user's coords
  // (address/zip/apiKey). When those user inputs change we drop the whole cache;
  // otherwise a provider whose id+address is unchanged reuses its computed distance.
  const distanceCacheRef = useRef<{ ctx: string; byProvider: Map<string, number> }>({ ctx: '', byProvider: new Map() });

  // 4. Geocode the user + each provider (by ZIP) and attach a distance in miles.
  useEffect(() => {
    let cancelled = false;
    const computeDistances = async () => {
      if (!providers.length) {
        setProvidersWithDistance([]);
        return;
      }
      const apiKey = config?.apiKeys?.googleMap;
      const userZip =
        extractZip(currentUserProfile?.address) ||
        extractZip(currentUserProfile?.zipCode) ||
        '10025';

      let userCoords: Coords;
      if (apiKey && currentUserProfile?.address) {
        userCoords =
          (await geocodeAddress(currentUserProfile.address, apiKey)) ??
          (await geocodeZip(userZip, apiKey));
      } else {
        userCoords = await geocodeZip(userZip, apiKey);
      }

      // Invalidate cached distances when the user's coord inputs change (they shift
      // every provider's distance); keep them when only unrelated provider data moved.
      const ctxKey = `${apiKey ?? ''}|${currentUserProfile?.address ?? ''}|${currentUserProfile?.zipCode ?? ''}`;
      if (distanceCacheRef.current.ctx !== ctxKey) {
        distanceCacheRef.current = { ctx: ctxKey, byProvider: new Map() };
      }
      const cache = distanceCacheRef.current.byProvider;

      const withDistance = await Promise.all(
        providers.map(async (p) => {
          const provKey = `${p.id}|${p.address ?? ''}|${p.zipCode ?? ''}`;
          const cached = cache.get(provKey);
          if (cached !== undefined) {
            // Already computed for this id+address under the current user coords —
            // reuse it (still spread fresh `p` so other provider fields stay current).
            return { ...p, distance: cached };
          }
          const providerZip = extractZip(p.zipCode) || extractZip(p.address);
          let providerCoords: Coords;
          if (apiKey && p.address) {
            providerCoords =
              (await geocodeAddress(p.address, apiKey)) ??
              (await geocodeZip(providerZip, apiKey));
          } else {
            providerCoords = await geocodeZip(providerZip, apiKey);
          }
          const distance = haversineMiles(userCoords, providerCoords);
          cache.set(provKey, distance);
          return { ...p, distance };
        })
      );

      if (!cancelled) setProvidersWithDistance(withDistance);
    };
    computeDistances().catch(err => console.warn('Distance computation error:', err));
    return () => { cancelled = true; };
  }, [providers, currentUserProfile?.address, currentUserProfile?.zipCode, config?.apiKeys?.googleMap]);
  
  // Build a lookup map: provider id → provider with distance
  const providerMap = useMemo(() => {
    const map = new Map<string, any>();
    providersWithDistance.forEach(p => map.set(p.id, p));
    return map;
  }, [providersWithDistance]);

  // Stable shuffle order for the promo carousel. The order is randomized ONCE per
  // distinct SET of visible promo ids and then remembered here, so unrelated provider
  // snapshots (which rebuild providerMap and re-run the memo below) no longer reshuffle
  // the cards. Only adding/removing a promo — a change to the actual set of ids —
  // produces a new shuffle.
  const shuffleOrderRef = useRef<{ key: string; order: string[] }>({ key: '', order: [] });

  // One carousel item per active promo — no deduplication by provider.
  // Each promo's own reachMiles controls visibility independently.
  const promoCarouselItems = useMemo(() => {
    const broadcastMile = config?.maxPushBroadCastMile || DEFAULT_RADIUS;
    // Hide offers this customer has already redeemed (per-customer single-use): the
    // promo's `usedBy` array holds the phone numbers that have used the code.
    const myPhone = authNative().currentUser?.phoneNumber;

    const items = promos
      .filter(promo => {
        if (!promo.isActive) return false;
        if (myPhone && promo.usedBy?.includes(myPhone)) return false;
        const provider = providerMap.get(promo.providerId);
        // Fail CLOSED: if we can't place the provider (no address/zip → no distance),
        // don't surface the promo rather than showing it everywhere.
        if (!provider || typeof provider.distance !== 'number') return false;
        // Visibility is strictly bounded by the reach the provider set on THIS promo
        // (miles from the provider's address). A set reach is NEVER widened; only a
        // legacy promo with no reachMiles falls back to the global broadcast radius.
        const reachRaw = Number(promo.reachMiles);
        const reach = Number.isFinite(reachRaw) && reachRaw > 0 ? reachRaw : broadcastMile;
        return provider.distance <= reach;
      })
      .map(promo => {
        const provider = providerMap.get(promo.providerId);
        return {
          ...provider,
          promoId: promo.id,
          promoTitle: promo.title,
          promoText: promo.text,
          promoPrice: promo.price,
          promoExpirationDate: promo.expirationDate,
          promoOfferCode: promo.offerCode,
          promoDiscountType: promo.discountType,
          promoDiscountValue: promo.discountValue ?? null,
          promoOfferExpDate: promo.offerExpDate,
          promoOfferType: promo.offerType ?? null,
        };
      });

    // Apply a STABLE shuffle: reshuffle only when the set of visible promo ids changes,
    // not on every providerMap identity change. `setKey` is order-independent so a mere
    // reorder of `items` (from unrelated provider updates) doesn't count as a new set.
    const ids = items.map(i => i.promoId);
    const setKey = [...ids].sort().join('|');
    if (shuffleOrderRef.current.key !== setKey) {
      const shuffled = [...ids];
      // Fisher-Yates
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      shuffleOrderRef.current = { key: setKey, order: shuffled };
    }
    const orderIndex = new Map(shuffleOrderRef.current.order.map((id, idx) => [id, idx] as const));
    items.sort((a, b) => (orderIndex.get(a.promoId) ?? 0) - (orderIndex.get(b.promoId) ?? 0));
    return items;
  }, [promos, providerMap, config?.maxPushBroadCastMile]);

  const handleCopyCode = async (promoId: string, code: string) => {
    await Clipboard.setStringAsync(code);
    setCopiedPromoId(promoId);
    if (copiedResetRef.current) clearTimeout(copiedResetRef.current);
    copiedResetRef.current = setTimeout(() => setCopiedPromoId(null), 2000);
  };

  const renderPromoCard = ({ item: provider }: { item: any }) => {
    const isCopied = copiedPromoId === provider.promoId;
    const discountLabel = provider.promoDiscountType === 'percentage'
      ? `${provider.promoDiscountValue}% OFF`
      : provider.promoDiscountValue != null
        ? `$${provider.promoDiscountValue} OFF`
        : null;

    const offerTypeLabel =
      provider.promoOfferType === 'rent' ? 'Rental Coupon' :
      provider.promoOfferType === 'rentToBuy' ? 'Rent to Buy' :
      provider.promoOfferType === 'buy' ? 'Purchase' : null;

    return (
      <View
        style={{ borderRadius: LAYOUT.borderRadius.card, marginBottom: 12, backgroundColor: '#FF7A3D' }}
        className="border-2 border-black shadow-brutalist overflow-hidden"
      >
        {/* Decorative circle */}
        <View className="absolute -top-8 -right-8 w-28 h-28 bg-white opacity-10 rounded-full" />

        {/* Top strip: business + offer type + discount badge */}
        <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
          <View className="flex-row items-center gap-1.5">
            <View className="w-1.5 h-1.5 rounded-full bg-emerald-300" />
            <Text className="text-orange-100 text-[9px] font-black uppercase tracking-widest">
              {provider.businessName || 'Special Offer'}
            </Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            {offerTypeLabel && (
              <View className="bg-black/30 px-2 py-0.5 rounded-full">
                <Text className="text-white font-black text-[9px] uppercase">{offerTypeLabel}</Text>
              </View>
            )}
            {discountLabel && (
              <View className="bg-white px-2 py-0.5 rounded-full">
                <Text style={{ color: COLORS.brand.green }} className="font-black text-[9px] uppercase">{discountLabel}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Title */}
        <Text className="text-white font-black text-base leading-tight px-4 mb-1" numberOfLines={1}>
          {provider.promoTitle || provider.businessName || 'Special Offer'}
        </Text>

        {/* Promo offer copy */}
        <Text className="text-orange-100 text-[11px] font-medium leading-snug px-4 mb-3" numberOfLines={2}>
          {provider.promoText}
        </Text>

        {/* Offer code row */}
        {provider.promoOfferCode && (
          <View className="mx-4 mb-3 rounded-xl px-3 py-2.5 flex-row items-center justify-between" style={{ backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}>
            <View>
              <Text className="text-orange-200 text-[7px] font-black uppercase tracking-widest mb-0.5">Offer Code</Text>
              <Text className="text-white font-black font-mono text-sm tracking-[3px]">{provider.promoOfferCode}</Text>
            </View>
            <TouchableOpacity
              onPress={() => handleCopyCode(provider.promoId, provider.promoOfferCode)}
              activeOpacity={0.7}
              className={`p-2 rounded-lg border ${isCopied ? 'bg-emerald-500/20 border-emerald-400/40' : 'border-white/30'}`}
              style={!isCopied ? { backgroundColor: 'rgba(0,0,0,0.25)' } : undefined}
            >
              {isCopied
                ? <Check size={14} color="#34d399" />
                : <Copy size={14} color="white" />
              }
            </TouchableOpacity>
          </View>
        )}

        {/* Apply to Next Order CTA */}
        <TouchableOpacity
          onPress={() => navigation.navigate('Wizard', {
            initialCouponCode: provider.promoOfferCode,
          })}
          activeOpacity={0.85}
          className="mx-4 mb-3 bg-black rounded-xl py-2.5 flex-row items-center justify-center gap-2"
        >
          <Zap size={13} color={COLORS.brand.green} fill={COLORS.brand.green} />
          <Text className="text-white font-black text-[11px] uppercase tracking-wide">Apply to Next Order</Text>
        </TouchableOpacity>

        {/* Footer meta */}
        <View className="flex-row items-center justify-between px-4 pb-3 pt-1" style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.2)' }}>
          <View className="flex-row items-center gap-1">
            <MapPin size={9} color="rgba(255,255,255,0.8)" />
            <Text className="text-orange-100 text-[9px] font-mono">{provider.distance?.toFixed(1)} mi</Text>
          </View>
          {provider.promoExpirationDate && (
            <Text className="text-orange-200 text-[8px] font-mono">Exp {provider.promoExpirationDate}</Text>
          )}
          {provider.promoPrice != null && (
            <View className="px-2 py-0.5 rounded-lg" style={{ backgroundColor: 'rgba(0,0,0,0.25)' }}>
              <Text className="text-white font-black text-[9px]">${Number(provider.promoPrice).toFixed(2)}/ld</Text>
            </View>
          )}
        </View>
      </View>
    );
  };



  return (
    <View className="flex-1 bg-white">
      {/* Fixed header — lives outside the scrollable FlatList */}
      <View className="px-4 pt-4">

        {/* Promo Welcome Banner */}
        <View
          style={{ borderRadius: LAYOUT.borderRadius.banner }}
          className="bg-indigo-600 p-5 shadow-brutalist relative overflow-hidden mb-6"
        >
          <View className="absolute -bottom-8 -right-8 w-32 h-32 bg-white opacity-10 rounded-full" />
          <Text className="text-[10px] uppercase font-bold text-indigo-100 tracking-wider">
            Welcome Back, {userName}!
          </Text>
          <Text className="text-xl font-extrabold text-white tracking-tight leading-tight mt-1">
            Need a bike for deliveries?
          </Text>
          <Text className="text-[11px] text-indigo-100 mt-2 mb-4 font-medium leading-relaxed">
            Create a load-estimated rental request and match with premium nearby providers.
          </Text>
          <StyledTouchableOpacity
            className="bg-white px-5 py-3 rounded-xl self-start flex-row items-center"
            activeOpacity={0.8}
          onPress={() => navigation.navigate('Wizard')}
          >
            <Text className="text-indigo-700 font-black text-xs mr-2 uppercase">Ride Now</Text>
            <ChevronRight size={14} color={COLORS.brand.greenDark} />
          </StyledTouchableOpacity>
        </View>

        {/* Section title */}
        <Text className="text-lg font-extrabold text-slate-900 tracking-tight mb-3">
          Deals & Coupons
        </Text>

      </View>

      {/* Scrollable promo cards */}
      <FlatList
        style={{ flex: 1 }}
        className="px-4"
        data={promoCarouselItems}
        keyExtractor={(item) => item.promoId}
        renderItem={renderPromoCard}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={loading ? (
          <ActivityIndicator color={COLORS.brand.green} className="mt-20" />
        ) : (
          <Text className="text-center text-slate-400 font-bold mt-20 uppercase text-xs">
            No promotions available nearby
          </Text>
        )}
        ListFooterComponent={<View className="h-24" />}
      />
    </View>
  );
}
