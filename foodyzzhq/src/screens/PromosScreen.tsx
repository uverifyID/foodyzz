import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tags, Plus, Compass, X, Sparkles, CreditCard, Tag, RefreshCw, ArrowLeft, User } from 'lucide-react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useStripe, CardField } from '@stripe/stripe-react-native';
import { COLORS, LAYOUT } from '../theme';
import { db, auth, getPromoDoc, getFunctionsInstance } from '../services/firebase';
import { useActiveProvider, useGlobalConfig } from '../hooks';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';

export default function PromosScreen() {
  const { top } = useSafeAreaInsets();
  const [promos, setPromos] = useState<any[]>([]);
  const config = useGlobalConfig();
  const { profile, loading: providerLoading } = useActiveProvider();
  const [isAddingPromo, setIsAddingPromo] = useState(false);
  const [promosLoading, setPromosLoading] = useState(true);
  const loading = providerLoading || (!!profile?.id && promosLoading);
  const navigation = useNavigation();
  const [providerZip, setProviderZip] = useState('10025');

  // Form states
  const [promoTitle, setPromoTitle] = useState('');
  const [promoPrice, setPromoPrice] = useState('12.00');
  const [promoText, setPromoText] = useState('');
  const [promoMonths, setPromoMonths] = useState(3);
  const [promoCardName, setPromoCardName] = useState('');
  const [cardComplete, setCardComplete] = useState(false);
  const [isSavingBilling, setIsSavingBilling] = useState(false);
  const [billingCardLast4, setBillingCardLast4] = useState('');
  const [billingCardBrand, setBillingCardBrand] = useState('');
  const [billingCardName, setBillingCardName] = useState('');

  // Detail modal states
  const [selectedPromo, setSelectedPromo] = useState<any | null>(null);
  const [detailFilter, setDetailFilter] = useState<'daily' | 'weekly' | 'all'>('all');

  // Offer / discount states
  const [offerType, setOfferType] = useState<'rent' | 'rentToBuy' | 'buy'>('rent');
  const [discountType, setDiscountType] = useState<'percentage' | 'amount'>('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [offerCode, setOfferCode] = useState('');
  const [offerExpMonths, setOfferExpMonths] = useState(3);
  const [promoMiles, setPromoMiles] = useState(5);

  // Highlighting and Scrolling
  const route = useRoute();
  const [highlightedPromoId, setHighlightedPromoId] = useState<string | null>(null);
  const promoRefs = useRef<{ [key: string]: View | null }>({});
  const promoLayouts = useRef<{ [key: string]: number }>({});
  const scrollViewRef = useRef<ScrollView>(null);

  const user = auth().currentUser;
  const { createPaymentMethod } = useStripe();

  // Promos for the active store. The provider doc (zip + billing card) now comes
  // from useActiveProvider, so this effect only owns the promos listener.
  useEffect(() => {
    if (!profile?.id) return;
    const unsub = db.collection('promos')
      .where('providerId', '==', profile.id)
      .onSnapshot(
        (snapshot) => {
          setPromos(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
          setPromosLoading(false);
        },
        (error) => { console.warn('Promos listener error:', error.message); setPromosLoading(false); },
      );
    return () => unsub();
  }, [profile?.id]);

  // Mirror the store zip + saved billing card from the live provider doc.
  useEffect(() => {
    if (!profile) return;
    setProviderZip(profile.zipCode || '');
    setBillingCardLast4(profile.billingCardLast4 || '');
    setBillingCardBrand(profile.billingCardBrand || '');
    setBillingCardName(profile.billingCardName || '');
  }, [profile]);

  useEffect(() => {
    const promoId = (route.params as { promoId?: string } | undefined)?.promoId;
    if (promoId) {
      setHighlightedPromoId(promoId);
      // Attempt to scroll to the item after a short delay to allow layout to settle
      const timer = setTimeout(() => {
        if (scrollViewRef.current && promoLayouts.current[promoId]) {
          scrollViewRef.current.scrollTo({
            y: promoLayouts.current[promoId] - 20, // Adjust offset as needed
            animated: true,
          });
        }
      }, 500); // Adjust delay as needed
      return () => clearTimeout(timer);
    }
  }, [route.params]);

  const generateOfferCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  };

  useEffect(() => {
    if (isAddingPromo) {
      setPromoTitle('');
      setOfferCode(generateOfferCode());
      setDiscountValue('');
      setOfferType('rent');
      setDiscountType('percentage');
      setOfferExpMonths(3);
      setPromoMiles(5);
      setCardComplete(false);
      setPromoCardName('');
    }
  }, [isAddingPromo]);

  const handleCreatePromo = async () => {
    if (!promoText) {
      Alert.alert("Setup Incomplete", "Please add promo offer text.");
      return;
    }

    const dv = parseFloat(discountValue);
    if (!discountValue || isNaN(dv) || dv <= 0) {
      Alert.alert("Offer Incomplete", "Please enter a valid discount value.");
      return;
    }
    if (discountType === 'percentage' && dv > 100) {
      Alert.alert("Invalid Discount", "Percentage cannot exceed 100%.");
      return;
    }

    const cleanPhone = user?.phoneNumber?.replace(/\D/g, '') || user?.email?.split('@')[0];
    // The provider's unique doc id — NOT `${phone}_${serviceZip}` (the service zip
    // is no longer the doc-key suffix). Promos are listed/billed by this id.
    const currentProviderId = profile?.id || `${cleanPhone}_${providerZip}`;

    if (!billingCardLast4) {
      if (!promoCardName || !cardComplete) {
        Alert.alert("Billing Incomplete", "Please enter cardholder name and complete card details.");
        return;
      }
      setIsSavingBilling(true);
      try {
        const { paymentMethod, error } = await createPaymentMethod({
          paymentMethodType: 'Card',
          paymentMethodData: { billingDetails: { name: promoCardName } },
        });
        if (error || !paymentMethod) {
          setIsSavingBilling(false);
          Alert.alert("Card Error", error?.message || "Could not process card details.");
          return;
        }
        const result = await getFunctionsInstance().httpsCallable('saveProviderBillingCard')({
          providerId: currentProviderId,
          paymentMethodId: paymentMethod.id,
          cardName: promoCardName,
        });
        const { last4, brand } = (result as any).data;
        setBillingCardLast4(last4);
        setBillingCardBrand(brand);
        setBillingCardName(promoCardName);
      } catch (err: any) {
        setIsSavingBilling(false);
        Alert.alert("Billing Error", err.message || "Could not save payment method.");
        return;
      }
      setIsSavingBilling(false);
    }

    const promoId = Math.random().toString(36).substring(2, 7).toUpperCase();
    const expiration = new Date();
    expiration.setMonth(expiration.getMonth() + promoMonths);

    const offerExpDate = new Date();
    offerExpDate.setMonth(offerExpDate.getMonth() + offerExpMonths);

    const newPromo = {
      providerId: currentProviderId,
      title: promoTitle,
      providerName: "My Rentals Hub",
      providerZip,
      price: parseFloat(promoPrice),
      text: promoText,
      monthsActive: promoMonths,
      expirationDate: expiration.toISOString().split('T')[0],
      viewsCounter: 0,
      isActive: true,
      cardNameOnInvoice: promoCardName || billingCardName,
      offerType,
      discountType,
      discountValue: parseFloat(discountValue),
      offerCode,
      offerExpDate: offerExpDate.toISOString().split('T')[0],
      reachMiles: promoMiles,
      usedBy: [],
      createdAt: new Date().toISOString()
    };

    try {
      await getPromoDoc(currentProviderId, promoId).set(newPromo);
      setIsAddingPromo(false);
      setPromoTitle('');
      setPromoText('');
      setPromoCardName('');
      setCardComplete(false);
      setDiscountValue('');
      Alert.alert("Success", `Campaign is now live in Zip Code: ${providerZip} · ${promoMiles}mi radius`);
    } catch (error) {
      Alert.alert("Sync Error", "Could not connect to marketing node.");
    }
  };

  const handleDeactivate = async (promoId: string) => {
    Alert.alert(
      "Deactivate Campaign",
      "Stop this marketing run immediately? Impressions served so far will still be billed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Stop Now",
          style: "destructive",
          onPress: async () => {
            try {
              await db.collection('promos').doc(promoId).update({ isActive: false });
            } catch (error) {
              Alert.alert("Sync Error", "Could not connect to marketing node.");
            }
          }
        }
      ]
    );
  };

  const activePromos = useMemo(() => promos.filter(p => p.isActive), [promos]);
  const inactivePromos = useMemo(() => promos.filter(p => !p.isActive), [promos]);

  if (loading) {
    return (
      <View className="flex-1 bg-white justify-center items-center">
        <ActivityIndicator color="#507425" />
      </View>
    );
  }
  return (
    <View className="flex-1 bg-white">
      {/* Header Area */}
      <View className="bg-slate-900 px-4 pb-6 border-b-4 border-black mb-6 shadow-sm flex-row justify-between items-end" style={{ paddingTop: top + 16 }}>
        <View>
          <Text className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest mb-1">
            Marketing Ops
          </Text>
          <Text className="text-2xl font-black text-white uppercase tracking-tighter">
            Promo<Text className="text-brand-green">.Campaigns</Text>
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          <TouchableOpacity
            onPress={() => (navigation as any).navigate('Account')}
            className="p-3 bg-slate-800 border-2 border-slate-700 rounded-2xl"
          >
            <User size={20} color="#94a3b8" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setIsAddingPromo(true)}
            activeOpacity={0.7}
            className="bg-brand-green p-3 rounded-2xl border-2 border-black shadow-brutalist"
          >
            <Plus size={22} color="black" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView ref={scrollViewRef} className="flex-1 px-4" showsVerticalScrollIndicator={false}>
        {/* Marketing Performance Statistics Summary */}
        <View className="flex-row gap-3 mb-8">
          <View className="flex-1 bg-slate-900 border-2 border-slate-800 rounded-3xl p-4 shadow-brutalist">
            <Text className="text-slate-400 text-[8px] font-black uppercase tracking-widest mb-1">Total Impressions</Text>
            <Text className="text-xl font-black text-white font-mono">
              {promos.reduce((sum, p) => sum + (p.viewsCounter || 0), 0)}
            </Text>
            <View className="flex-row items-center gap-1.5 mt-2">
              <Sparkles size={10} color="#86B54F" />
              <Text className="text-slate-400 text-[7px] font-bold uppercase tracking-tighter">Live reach metrics</Text>
            </View>
          </View>
          <View className="flex-1 bg-slate-900 border-2 border-slate-800 rounded-3xl p-4 shadow-brutalist">
            <Text className="text-slate-400 text-[8px] font-black uppercase tracking-widest mb-1">Marketing Debt</Text>
            <Text className="text-xl font-black text-brand-green font-mono">
              ${promos.reduce((sum, p) => sum + ((p.viewsCounter || 0) * (config?.promoCostPerCount || 0.05)), 0).toFixed(2)}
            </Text>
            <View className="flex-row items-center gap-1.5 mt-2">
              <CreditCard size={10} color="#86B54F" />
              <Text className="text-slate-400 text-[7px] font-bold uppercase tracking-tighter">Current billing</Text>
            </View>
          </View>
        </View>

        <View className="flex-row justify-between items-center mb-4 px-1">
          <Text className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Active Zip Campaigns ({activePromos.length})
          </Text>
          <View className="bg-slate-900 px-2 py-1 rounded border border-slate-800">
            <Text className="text-slate-200 font-mono text-[9px] font-bold">{providerZip} FOCUS</Text>
          </View>
        </View>

        {activePromos.length === 0 ? (
          <View className="p-10 bg-slate-950 border-2 border-dashed border-slate-900 rounded-[32px] items-center">
            <Tags size={40} color="#1e293b" className="mb-4" />
            <Text className="text-slate-400 font-bold text-center text-sm">No active marketing runs.</Text>
            <Text className="text-slate-600 text-[10px] text-center mt-2 uppercase font-mono leading-relaxed">
              Target local clients in {providerZip} with deal-specific campaigns.
            </Text>
          </View>
        ) : (
          activePromos.map((promo) => (
            <TouchableOpacity
              key={promo.id}
              activeOpacity={0.9}
              onPress={() => { setSelectedPromo(promo); setDetailFilter('all'); }}
              ref={el => (promoRefs.current[promo.id] = el as any)}
              onLayout={event => { promoLayouts.current[promo.id] = event.nativeEvent.layout.y; }}
              className={`bg-slate-900 border-2 rounded-[32px] p-5 mb-4 shadow-brutalist overflow-hidden ${promo.id === highlightedPromoId ? 'border-yellow-400' : 'border-slate-800'}`}
            >
              <View className="flex-row justify-between items-start mb-4">
                <View>
                  <View className="flex-row items-center gap-1.5 mb-1">
                    <Compass size={14} color="#86B54F" />
                    <Text className="text-white font-black text-xs uppercase tracking-tight">Zip {promo.providerZip} · {promo.reachMiles || 5}mi</Text>
                  </View>
                  <Text className="text-slate-500 font-mono text-[9px] uppercase">Ref: {promo.id.split('_').pop()}</Text>
                </View>
              <View className="bg-brand-green/10 border border-brand-green/30 px-3 py-1 rounded-xl">
                <Text className="text-brand-green font-mono font-black text-[11px]">${promo.price.toFixed(2)}/ld</Text>
                </View>
              </View>

              <View className="bg-slate-950 p-4 rounded-2xl border border-slate-800 mb-4">
                <Text className="text-slate-300 text-xs font-bold leading-relaxed italic">
                  "{promo.text}"
                </Text>
              </View>

              <View className="flex-row gap-3 mb-4">
                <View className="flex-1 bg-slate-950 p-3 rounded-2xl border border-slate-800 items-center">
                  <Text className="text-white text-base font-black font-mono">{promo.viewsCounter}</Text>
                  <Text className="text-slate-400 text-[8px] font-bold uppercase tracking-widest mt-1">Impressions</Text>
                </View>
                <View className="flex-1 bg-slate-950 p-3 rounded-2xl border border-slate-800 items-center">
                  <Text className="text-brand-green text-base font-black font-mono">
                    ${(promo.viewsCounter * (config?.promoCostPerCount || 0.05)).toFixed(2)}
                  </Text>
                  <Text className="text-slate-400 text-[8px] font-bold uppercase tracking-widest mt-1">Acct Debit</Text>
                </View>
              </View>

              {promo.offerCode && (
                <View className="bg-slate-950 p-3 rounded-2xl border border-slate-800 mb-4">
                  <Text className="text-slate-500 text-[8px] font-black uppercase tracking-widest mb-2">Offer Code</Text>
                  <View className="flex-row items-center justify-between">
                    <Text className="text-white font-mono font-black text-sm tracking-[4px]">{promo.offerCode}</Text>
                    <View className="bg-brand-green/10 border border-brand-green/20 px-2 py-0.5 rounded-lg">
                      <Text className="text-brand-green font-mono font-black text-[9px] uppercase">
                        {promo.discountType === 'percentage' ? `${promo.discountValue}% OFF` : `$${promo.discountValue} OFF`}
                        {' · '}{promo.offerType?.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <Text className="text-slate-600 text-[8px] font-mono mt-1.5">Expires: {promo.offerExpDate}</Text>
                </View>
              )}

              <View className="flex-row justify-between items-center pt-4 border-t border-slate-800">
                <Text className="text-slate-500 text-[9px] font-black font-mono uppercase">Exp: {promo.expirationDate}</Text>
                {promo.isActive ? (
                  <TouchableOpacity
                    onPress={() => handleDeactivate(promo.id)}
                    activeOpacity={0.7}
                    className="bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-lg"
                  >
                    <Text className="text-emerald-400 font-black text-[8px] uppercase font-mono">Live (Stop SVC)</Text>
                  </TouchableOpacity>
                ) : (
                  <View className="bg-slate-800 border border-slate-700 px-2.5 py-1 rounded-lg">
                    <Text className="text-slate-500 font-black text-[8px] uppercase font-mono">Deactivated</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          ))
        )}

        {/* Campaign History Section */}
        {inactivePromos.length > 0 && (
          <>
            <View className="mt-12 mb-4 px-1 border-t border-slate-900 pt-8">
              <Text className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Campaign History ({inactivePromos.length})
              </Text>
            </View>
            {inactivePromos.map((promo) => (
              <TouchableOpacity
                key={promo.id}
                activeOpacity={0.9}
                onPress={() => { setSelectedPromo(promo); setDetailFilter('all'); }}
                ref={el => (promoRefs.current[promo.id] = el as any)}
                onLayout={event => { promoLayouts.current[promo.id] = event.nativeEvent.layout.y; }}
                className={`bg-slate-800 border-2 rounded-[32px] p-5 mb-4 ${promo.id === highlightedPromoId ? 'border-yellow-400' : 'border-slate-700'}`}
              >
                <View className="flex-row justify-between items-start mb-3">
                  <View className="flex-1 mr-3">
                    <Text className="text-white font-black text-sm mb-1" numberOfLines={1}>
                      {promo.title || `Ref: ${promo.id.split('_').pop()}`}
                    </Text>
                    <View className="flex-row items-center gap-1.5">
                      <Compass size={11} color="#64748b" />
                      <Text className="text-slate-500 font-mono text-[9px] uppercase">Zip {promo.providerZip} · Ref {promo.id.split('_').pop()}</Text>
                    </View>
                  </View>
                  <View className="bg-slate-700 border border-slate-600 px-3 py-1 rounded-xl">
                    <Text className="text-slate-400 font-mono font-black text-[11px]">${promo.price.toFixed(2)}/ld</Text>
                  </View>
                </View>

                <View className="flex-row justify-between items-center pt-3 border-t border-slate-700">
                  <Text className="text-slate-400 text-[9px] font-black font-mono uppercase">Ended: {promo.expirationDate}</Text>
                  <View className="bg-slate-700 border border-slate-600 px-2.5 py-1 rounded-lg">
                    <Text className="text-slate-300 font-black text-[8px] uppercase font-mono">Deactivated · View →</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}
        <View className="h-24" />
      </ScrollView>

      {/* Campaign Detail Modal */}
      {selectedPromo && (() => {
        const rate = config?.promoCostPerCount || 0.05;
        const totalImpressions = selectedPromo.viewsCounter || 0;
        const startDate = selectedPromo.createdAt ? new Date(selectedPromo.createdAt) : new Date();
        const endDate = selectedPromo.isActive ? new Date() : new Date(selectedPromo.expirationDate);
        const daysRunning = Math.max(1, Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
        const dailyAvg = totalImpressions / daysRunning;
        const impressions = detailFilter === 'daily' ? Math.round(dailyAvg) : detailFilter === 'weekly' ? Math.round(dailyAvg * 7) : totalImpressions;
        const charged = impressions * rate;
        const filterLabel = detailFilter === 'daily' ? 'avg / day' : detailFilter === 'weekly' ? 'avg / week' : 'campaign total';
        return (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#020617', zIndex: 150 }}>
            {/* Header */}
            <View className="flex-row items-center px-5 border-b border-slate-800" style={{ paddingTop: top + 12, paddingBottom: 16 }}>
              <TouchableOpacity onPress={() => setSelectedPromo(null)} className="p-2 bg-slate-900 border border-slate-800 rounded-2xl mr-4" activeOpacity={0.7}>
                <ArrowLeft size={18} color="white" />
              </TouchableOpacity>
              <Text className="text-white font-black text-base uppercase tracking-tighter flex-1">Campaign Detail</Text>
              <View className={`px-2.5 py-1 rounded-lg border ${selectedPromo.isActive ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-slate-800 border-slate-700'}`}>
                <Text className={`font-black text-[9px] uppercase font-mono ${selectedPromo.isActive ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {selectedPromo.isActive ? 'Live' : 'Ended'}
                </Text>
              </View>
            </View>

            <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
              {/* Title + Meta */}
              <View className="px-5 py-5 border-b border-slate-800">
                <Text className="text-white font-black text-xl mb-2">
                  {selectedPromo.title || `Campaign ${selectedPromo.id.split('_').pop()}`}
                </Text>
                <View className="flex-row items-center gap-2">
                  <Compass size={11} color="#64748b" />
                  <Text className="text-slate-500 font-mono text-[10px] uppercase">Zip {selectedPromo.providerZip}</Text>
                  <Text className="text-slate-700">·</Text>
                  <Text className="text-brand-green font-mono text-[10px] uppercase font-black">{selectedPromo.reachMiles || 5}mi radius</Text>
                  <Text className="text-slate-700">·</Text>
                  <Text className="text-slate-600 font-mono text-[10px] uppercase">Ref {selectedPromo.id.split('_').pop()}</Text>
                </View>
              </View>

              {/* Date Range */}
              <View className="flex-row px-5 py-4 gap-3 border-b border-slate-800">
                <View className="flex-1 bg-slate-900 rounded-2xl p-4 border border-slate-800">
                  <Text className="text-slate-500 text-[8px] font-black uppercase tracking-widest mb-1">Started</Text>
                  <Text className="text-white font-mono font-bold text-xs">{selectedPromo.createdAt?.split('T')[0] || '—'}</Text>
                </View>
                <View className="flex-1 bg-slate-900 rounded-2xl p-4 border border-slate-800">
                  <Text className="text-slate-500 text-[8px] font-black uppercase tracking-widest mb-1">{selectedPromo.isActive ? 'Expires' : 'Ended'}</Text>
                  <Text className={`font-mono font-bold text-xs ${selectedPromo.isActive ? 'text-emerald-400' : 'text-slate-400'}`}>{selectedPromo.expirationDate || '—'}</Text>
                </View>
              </View>

              {/* Filter Tabs + Stats */}
              <View className="px-5 py-5 border-b border-slate-800">
                <Text className="text-slate-500 text-[9px] font-black uppercase tracking-widest mb-3">Performance</Text>
                <View className="flex-row bg-slate-900 rounded-2xl p-1 mb-4 border border-slate-800">
                  {(['daily', 'weekly', 'all'] as const).map(f => (
                    <TouchableOpacity
                      key={f}
                      onPress={() => setDetailFilter(f)}
                      className={`flex-1 py-2 rounded-xl items-center ${detailFilter === f ? 'bg-brand-green' : ''}`}
                      activeOpacity={0.7}
                    >
                      <Text className={`font-black text-[10px] uppercase ${detailFilter === f ? 'text-black' : 'text-slate-500'}`}>{f}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View className="flex-row gap-3">
                  <View className="flex-1 bg-slate-900 rounded-2xl p-4 border border-slate-800 items-center">
                    <Text className="text-white text-2xl font-black font-mono">{impressions.toLocaleString()}</Text>
                    <Text className="text-slate-400 text-[8px] font-bold uppercase tracking-widest mt-1">Impressions</Text>
                    <Text className="text-slate-600 text-[7px] font-mono mt-0.5">{filterLabel}</Text>
                  </View>
                  <View className="flex-1 bg-slate-900 rounded-2xl p-4 border border-slate-800 items-center">
                    <Text className="text-brand-green text-2xl font-black font-mono">${charged.toFixed(2)}</Text>
                    <Text className="text-slate-400 text-[8px] font-bold uppercase tracking-widest mt-1">Charged</Text>
                    <Text className="text-slate-600 text-[7px] font-mono mt-0.5">{filterLabel}</Text>
                  </View>
                </View>
              </View>

              {/* Billing Note */}
              <View className="mx-5 mt-4 p-4 bg-slate-900 rounded-2xl border border-slate-800">
                <View className="flex-row items-center gap-2 mb-2">
                  <CreditCard size={12} color="#86B54F" />
                  <Text className="text-slate-400 text-[9px] font-black uppercase tracking-widest">Billing Notes</Text>
                </View>
                <Text className="text-slate-500 text-[10px] leading-relaxed font-mono">
                  • Charged at ${rate.toFixed(2)}/impression on each PromoInvoice cycle.{'\n'}
                  • Final settlement billed when campaign ends based on total impressions served.{'\n'}
                  • {daysRunning} day{daysRunning !== 1 ? 's' : ''} running · ${(totalImpressions * rate).toFixed(2)} total accrued
                </Text>
              </View>

              {/* Offer Details */}
              <View className="mx-5 mt-4 p-4 bg-slate-900 rounded-2xl border border-slate-800">
                <Text className="text-slate-400 text-[9px] font-black uppercase tracking-widest mb-3">Offer Details</Text>
                {selectedPromo.title ? (
                  <View className="bg-slate-950 p-3 rounded-xl border border-slate-800 mb-2">
                    <Text className="text-slate-500 text-[8px] font-black uppercase tracking-widest mb-1">Title</Text>
                    <Text className="text-white font-black text-sm">{selectedPromo.title}</Text>
                  </View>
                ) : null}
                <View className="bg-slate-950 p-3 rounded-xl border border-slate-800 mb-3">
                  <Text className="text-slate-500 text-[8px] font-black uppercase tracking-widest mb-1">Promo Copy</Text>
                  <Text className="text-slate-300 text-xs font-bold leading-relaxed italic">"{selectedPromo.text}"</Text>
                </View>
                <View className="flex-row gap-2 mb-2">
                  <View className="bg-slate-800 px-3 py-1.5 rounded-lg flex-1 items-center">
                    <Text className="text-slate-400 text-[8px] font-black uppercase tracking-wider">Applies To</Text>
                    <Text className="text-white font-black text-[11px] uppercase mt-0.5">{selectedPromo.offerType || '—'}</Text>
                  </View>
                  <View className="bg-slate-800 px-3 py-1.5 rounded-lg flex-1 items-center">
                    <Text className="text-slate-400 text-[8px] font-black uppercase tracking-wider">Discount</Text>
                    <Text className="text-brand-green font-black text-[11px] uppercase mt-0.5">
                      {selectedPromo.discountType === 'percentage' ? `${selectedPromo.discountValue}% OFF` : `$${selectedPromo.discountValue} OFF`}
                    </Text>
                  </View>
                  <View className="bg-slate-800 px-3 py-1.5 rounded-lg flex-1 items-center">
                    <Text className="text-slate-400 text-[8px] font-black uppercase tracking-wider">Deal Price</Text>
                    <Text className="text-white font-black text-[11px] mt-0.5">${selectedPromo.price?.toFixed(2)}/ld</Text>
                  </View>
                </View>
                {selectedPromo.offerCode && (
                  <View className="flex-row items-center justify-between bg-slate-950 px-3 py-2.5 rounded-xl border border-slate-800 mt-1">
                    <View>
                      <Text className="text-slate-500 text-[8px] font-black uppercase tracking-widest">Offer Code</Text>
                      <Text className="text-white font-mono font-black text-sm tracking-[4px] mt-0.5">{selectedPromo.offerCode}</Text>
                    </View>
                    <Text className="text-slate-600 font-mono text-[8px]">Exp {selectedPromo.offerExpDate}</Text>
                  </View>
                )}
              </View>
            </ScrollView>
          </View>
        );
      })()}

      {/* Campaign form overlay — rendered in the main window (not a Dialog) so Compose lifecycle works */}
      {isAddingPromo && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'flex-end', zIndex: 100 }}>
          <View className="bg-[#020617] rounded-t-[44px] border-t-4 border-slate-800 p-6 h-[85%]">
            <View className="flex-row justify-between items-center mb-6">
              <View>
                <Text className="text-white text-xl font-black uppercase tracking-tighter">New Campaign</Text>
                <Text className="text-slate-400 text-[10px] font-bold uppercase font-mono">Zip: {providerZip} · {promoMiles}mi</Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsAddingPromo(false)}
                className="p-2 bg-slate-900 border border-slate-800 rounded-2xl"
              >
                <X size={20} color="white" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} className="space-y-5">
              <View>
                <Text className="text-slate-400 text-[10px] font-black uppercase mb-2 ml-1 tracking-widest">1. Title</Text>
                <TextInput
                  value={promoTitle}
                  onChangeText={setPromoTitle}
                  placeholder="e.g. Summer Special, First Load Free..."
                  placeholderTextColor="#94a3b8"
                  className="bg-slate-950 border-2 border-slate-800 rounded-2xl p-4 text-white font-bold text-base"
                />
              </View>

              <View>
                <Text className="text-slate-400 text-[10px] font-black uppercase mb-2 ml-1 tracking-widest">2. Promo Offer Copy</Text>
                <TextInput
                  value={promoText}
                  onChangeText={setPromoText}
                  multiline
                  placeholder="e.g. 15% off first order + deluxe softener..."
                  placeholderTextColor="#94a3b8"
                  className="bg-slate-950 border-2 border-slate-800 rounded-2xl p-4 font-bold h-28 text-sm text-white"
                />
              </View>

              {/* 3. Offer Type */}
              <View>
                <Text className="text-slate-400 text-[10px] font-black uppercase mb-2 ml-1 tracking-widest">3. Offer Applies To</Text>
                <View className="flex-row gap-2">
                  {([
                    { key: 'rent', label: 'Rent' },
                    { key: 'rentToBuy', label: 'Rent to Buy' },
                    { key: 'buy', label: 'Buy' },
                  ] as const).map(({ key, label }) => (
                    <TouchableOpacity
                      key={key}
                      onPress={() => setOfferType(key)}
                      className={`flex-1 py-3 rounded-xl border-2 items-center ${offerType === key ? 'bg-brand-green border-black' : 'bg-slate-950 border-slate-800'}`}
                    >
                      <Text className={`font-black text-[10px] uppercase ${offerType === key ? 'text-black' : 'text-slate-500'}`}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* 4. Discount */}
              <View>
                <Text className="text-slate-400 text-[10px] font-black uppercase mb-2 ml-1 tracking-widest">4. Discount Value</Text>
                <View className="flex-row gap-3 items-stretch">
                  <TextInput
                    value={discountValue}
                    onChangeText={(t) => setDiscountValue(t.replace(/[^0-9.]/g, ''))}
                    placeholder="0"
                    placeholderTextColor="#475569"
                    keyboardType="decimal-pad"
                    className="flex-1 bg-slate-950 border-2 border-slate-800 rounded-2xl p-4 text-white font-mono font-bold text-lg"
                  />
                  <View className="flex-row bg-slate-950 border-2 border-slate-800 rounded-2xl overflow-hidden">
                    <TouchableOpacity
                      onPress={() => setDiscountType('percentage')}
                      className={`px-5 justify-center ${discountType === 'percentage' ? 'bg-brand-green' : ''}`}
                    >
                      <Text className={`font-black text-base ${discountType === 'percentage' ? 'text-black' : 'text-slate-500'}`}>%</Text>
                    </TouchableOpacity>
                    <View style={{ width: 1, backgroundColor: '#1e293b' }} />
                    <TouchableOpacity
                      onPress={() => setDiscountType('amount')}
                      className={`px-5 justify-center ${discountType === 'amount' ? 'bg-brand-green' : ''}`}
                    >
                      <Text className={`font-black text-base ${discountType === 'amount' ? 'text-black' : 'text-slate-500'}`}>$</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {/* 5. Offer Code */}
              <View className="bg-slate-900 p-4 rounded-2xl border border-slate-700">
                <View className="flex-row items-center gap-2 mb-3">
                  <Tag size={14} color="#86B54F" />
                  <Text className="text-slate-400 text-[10px] font-black uppercase tracking-widest">5. Offer Code</Text>
                </View>
                <View className="flex-row items-center justify-between bg-slate-950 px-4 py-3 rounded-xl border border-slate-800">
                  <Text className="text-white text-xl font-black font-mono tracking-[6px]">{offerCode}</Text>
                  <TouchableOpacity
                    onPress={() => setOfferCode(generateOfferCode())}
                    className="bg-slate-800 border border-slate-700 p-2 rounded-lg"
                  >
                    <RefreshCw size={14} color="#94a3b8" />
                  </TouchableOpacity>
                </View>
                <View className="mt-3 p-3 bg-black/30 rounded-xl border border-slate-800/50">
                  <Text className="text-slate-500 text-[9px] leading-relaxed font-mono">
                    This code applies to any order placed by the customer and can only be used once.
                  </Text>
                </View>
              </View>

              {/* 6. Code Expiry */}
              <View>
                <Text className="text-slate-400 text-[10px] font-black uppercase mb-2 ml-1 tracking-widest">6. Code Valid For</Text>
                <View className="flex-row gap-2">
                  {([1, 3, 6, 12] as const).map(months => (
                    <TouchableOpacity
                      key={months}
                      onPress={() => setOfferExpMonths(months)}
                      className={`flex-1 py-3 rounded-xl border-2 items-center ${offerExpMonths === months ? 'bg-brand-green border-black' : 'bg-slate-950 border-slate-800'}`}
                    >
                      <Text className={`font-black text-[10px] uppercase ${offerExpMonths === months ? 'text-black' : 'text-slate-500'}`}>
                        {months === 12 ? '1 Yr' : `${months} Mo`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* 7. Reach Radius */}
              <View>
                <Text className="text-slate-400 text-[10px] font-black uppercase mb-1 ml-1 tracking-widest">7. Reach Radius</Text>
                <Text className="text-slate-600 text-[9px] font-mono mb-2 ml-1">Customers within this distance of {providerZip} will see this promo.</Text>
                <View className="flex-row gap-2">
                  {([1, 5, 10, 25] as const).map(miles => (
                    <TouchableOpacity
                      key={miles}
                      onPress={() => setPromoMiles(miles)}
                      className={`flex-1 py-3 rounded-xl border-2 items-center ${promoMiles === miles ? 'bg-brand-green border-black' : 'bg-slate-950 border-slate-800'}`}
                    >
                      <Text className={`font-black text-[10px] uppercase ${promoMiles === miles ? 'text-black' : 'text-slate-500'}`}>{miles}mi</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View className="bg-slate-900/50 p-5 rounded-[32px] border-2 border-black shadow-brutalist">
                <View className="flex-row items-center gap-2 mb-4 border-b border-black/20 pb-2">
                  <CreditCard size={18} color="#86B54F" />
                  <Text className="text-white font-black text-xs uppercase">Billing Setup</Text>
                </View>

                {billingCardLast4 ? (
                  <View className="flex-row items-center justify-between mb-3">
                    <View className="flex-row items-center gap-3">
                      <View className="bg-emerald-500/10 border border-emerald-500/30 p-2 rounded-xl">
                        <CreditCard size={16} color="#10b981" />
                      </View>
                      <View>
                        <Text className="text-white font-bold text-xs capitalize">{billingCardBrand} ••••{billingCardLast4}</Text>
                        <Text className="text-emerald-400 text-[10px] font-black uppercase font-mono">Saved to Stripe</Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => { setBillingCardLast4(''); setBillingCardBrand(''); }}
                      className="bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-xl"
                    >
                      <Text className="text-slate-300 font-bold text-[10px] uppercase">Change</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    <TextInput
                      value={promoCardName}
                      onChangeText={setPromoCardName}
                      placeholder="Name on Card"
                      placeholderTextColor="#94a3b8"
                      autoCapitalize="words"
                      className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-white text-xs font-bold mb-3"
                    />
                    {/* Wrap the native CardField in the same bordered box the other
                        fields use so its border aligns with them (no double border —
                        the field itself draws borderless inside the wrapper). */}
                    <View className="bg-slate-950 border border-slate-800 rounded-xl px-3 justify-center" style={{ height: 54 }}>
                      <CardField
                        postalCodeEnabled={true}
                        onCardChange={(details) => setCardComplete(details.complete)}
                        style={{ width: '100%', height: 50 }}
                        cardStyle={{
                          backgroundColor: '#020617',
                          textColor: '#ffffff',
                          placeholderColor: '#94a3b8',
                          borderWidth: 0,
                          borderRadius: 8,
                        }}
                      />
                    </View>
                  </>
                )}

                {/* Clear vertical space above + below so the rate box never crowds the
                    card field, and a matching border so all three boxes line up. */}
                <View className="mt-4 mb-1 p-3 bg-slate-950 border border-slate-800 rounded-xl items-center flex-row justify-center gap-2">
                  <Sparkles size={12} color="#86B54F" />
                  <Text className="text-brand-green font-mono font-black text-[10px] uppercase">
                    Rate: ${config?.promoCostPerCount || 0.05} / Impression
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={handleCreatePromo}
                activeOpacity={0.8}
                disabled={isSavingBilling}
                className="bg-brand-green p-5 rounded-3xl border-4 border-black shadow-brutalist my-6"
              >
                {isSavingBilling ? (
                  <View className="flex-row items-center justify-center gap-2">
                    <ActivityIndicator size="small" color="black" />
                    <Text className="text-black font-black uppercase text-base tracking-tight">Saving Card...</Text>
                  </View>
                ) : (
                  <Text className="text-black font-black uppercase text-center text-base tracking-tight">Activate & Launch</Text>
                )}
              </TouchableOpacity>

              <View className="h-10" />
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  );
}
