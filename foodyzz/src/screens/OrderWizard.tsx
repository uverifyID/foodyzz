// Foodyzz rental wizard — the customer's only order flow.
//
//   1. Start date        (defaults to tomorrow)
//   2. Delivery time     (a slot inside the configured 5–9pm window)
//   3. Rental type       (Rent · Rent to Buy · Buy)
//   4. Bike model        (image, price, minimum commitment, live availability)
//   5. Fees              (skipped for Buy; required fees are locked on)
//   6. Location + pay    (the customer picks the FoodyzzHQ store — no broadcast)
//
// Everything priced here is quoted from `apiConfig/logistics` via services/logistics
// so the customer app, FoodyzzHQ and the Cloud Functions never drift.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Image, TextInput } from 'react-native';
import { Bike as BikeIcon, Calendar, Clock, MapPin, ShieldCheck, Check, CreditCard, Info } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { useStripe } from '@stripe/stripe-react-native';
import * as Haptics from 'expo-haptics';
import { db, generateOrderId, subscribeToGlobalConfig, auth, getFunctionsInstance } from '../services/firebase';
import {
  DEFAULT_LOGISTICS,
  subscribeToLogisticsConfig,
  deliverySlots,
  tomorrowDay,
  todayDay,
  addDays,
  parseDay,
  expectedEndDate,
  fetchBikes,
  modelAvailability,
  minCommitmentFor,
  rateFor,
  feesFor,
  toOrderFees,
  computeQuote,
} from '../services/logistics';
import type { Bike, LogisticsConfig, RentalType } from '../types';
import { useUserProfile } from '../context/UserProfileContext';
import { useStripeReady } from '../context/StripeReadyContext';

const RENTAL_TYPES: { key: RentalType; label: string; blurb: string }[] = [
  { key: 'rent', label: 'Rent', blurb: 'Weekly rental. New or used bike.' },
  { key: 'rentToBuy', label: 'Rent to Buy', blurb: 'Monthly payments, the bike is yours at the end. Always a new bike.' },
  { key: 'buy', label: 'Buy', blurb: 'One-time purchase. Always a new bike.' },
];

// Indexed by step NUMBER (step - 1), not display order — the display order lives in
// stepSequence. Step 3 (rental type) is chosen first; the date step (1) relabels for Buy.
const STEP_TITLES = ['Start date', 'Delivery time', 'Type', 'Your bike', 'Fees', 'Confirm'];

// Human label for a YYYY-MM-DD day, e.g. "Wed, Jul 22".
const dayLabel = (day: string): string =>
  parseDay(day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export default function OrderWizard() {
  const navigation = useNavigation<any>();
  const { initPaymentSheet, presentPaymentSheet, confirmPayment } = useStripe();
  // False until the real Stripe publishable key has replaced the placeholder the
  // StripeProvider mounts with — gates the pay CTA so checkout can't open against it.
  const stripeReady = useStripeReady();

  // Rental type is the first step (step id 3) so the date step can adapt its label —
  // Buy asks "when do you need it by?" instead of "when do you start?".
  const [step, setStep] = useState(3);
  const [config, setConfig] = useState<any>(null);
  const [logistics, setLogistics] = useState<LogisticsConfig>(DEFAULT_LOGISTICS);
  // Customer profile from the shared single listener (UserProfileContext) instead of
  // a duplicate per-screen users/{phone} onSnapshot.
  const { profile: userProfile } = useUserProfile();
  const [bikes, setBikes] = useState<Bike[]>([]);
  const [bikesLoading, setBikesLoading] = useState(true);

  // ── Selections ────────────────────────────────────────────────────────────
  const [startDate, setStartDate] = useState<string>(tomorrowDay());
  const [deliveryTime, setDeliveryTime] = useState<string>('');
  const [rentalType, setRentalType] = useState<RentalType | null>(null);
  const [bikeModel, setBikeModel] = useState<number | null>(null);
  // Fees the customer switched OFF. Only possible for `required: false` fees.
  const [optedOutFees, setOptedOutFees] = useState<string[]>([]);
  // Committed term. Seeded from the model's minimum and never allowed below it.
  const [durationValue, setDurationValue] = useState<number>(0);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [providers, setProviders] = useState<any[]>([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Display order: rental type (3) first, then date (1), delivery (2), bike (4),
  // fees (5), confirm (6). Buy has no fee step.
  const stepSequence = useMemo(
    () => (rentalType === 'buy' ? [3, 1, 2, 4, 6] : [3, 1, 2, 4, 5, 6]),
    [rentalType],
  );
  const currentIdx = stepSequence.indexOf(step);
  const goNext = useCallback(() => {
    const next = stepSequence[currentIdx + 1];
    if (next !== undefined) setStep(next);
  }, [stepSequence, currentIdx]);
  const goBack = useCallback(() => {
    const prev = stepSequence[currentIdx - 1];
    if (prev !== undefined) setStep(prev);
  }, [stepSequence, currentIdx]);

  // ── Data ──────────────────────────────────────────────────────────────────
  useEffect(() => subscribeToGlobalConfig(setConfig), []);
  useEffect(() => subscribeToLogisticsConfig(setLogistics), []);

  // (Customer profile is now provided by UserProfileContext — see useUserProfile above.)

  // Availability is read once per wizard run (and again whenever the start date
  // moves) rather than live-subscribed: a bike freeing up mid-checkout shouldn't
  // silently change the card the customer is looking at.
  useEffect(() => {
    let cancelled = false;
    setBikesLoading(true);
    fetchBikes()
      .then((b) => { if (!cancelled) setBikes(b); })
      .catch((e) => console.warn('fetchBikes failed:', e))
      .finally(() => { if (!cancelled) setBikesLoading(false); });
    return () => { cancelled = true; };
  }, [startDate]);

  // The customer picks the store explicitly — there is no broadcast on this platform.
  useEffect(() => {
    return db
      .collection('providers')
      .where('onboarded', '==', true)
      // Cap the stream as the provider base grows (defensive read bound).
      .limit(200)
      .onSnapshot(
        (snap) => {
          const rows = snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as any) }))
            .filter((p) => !p.isBlocked && p.servicesActive !== false);
          setProviders(rows);
          // The customer never picks a store — bikes are always delivered to them —
          // so the first available location is assigned automatically.
          if (rows.length > 0) setSelectedProviderId((prev) => prev ?? rows[0].id);
        },
        (e) => console.warn('providers listener failed:', e),
      );
  }, []);

  // Default the delivery slot to the first one in the configured window.
  const slots = useMemo(() => deliverySlots(logistics), [logistics]);
  useEffect(() => {
    if (!deliveryTime && slots.length) setDeliveryTime(slots[0]);
  }, [slots, deliveryTime]);

  // Seed the term from the selected model's minimum commitment, and never let a
  // later model/type change leave a term below the new minimum.
  const commitment = useMemo(
    () => (bikeModel && rentalType ? minCommitmentFor(logistics, bikeModel, rentalType) : null),
    [logistics, bikeModel, rentalType],
  );
  useEffect(() => {
    if (!commitment) return;
    setDurationValue((prev) => (prev < commitment.value ? commitment.value : prev));
  }, [commitment]);

  // Rent-to-buy and Buy always start from NEW inventory; Rent may use either.
  const availability = useMemo(() => {
    if (!rentalType) return [];
    return logistics.bikeModels.map((m) =>
      modelAvailability(bikes, logistics, m.model, rentalType, startDate),
    );
  }, [bikes, logistics, rentalType, startDate]);

  const availabilityFor = useCallback(
    (model: number) => availability.find((a) => a.model === model),
    [availability],
  );

  const orderFees = useMemo(
    () => (rentalType ? toOrderFees(feesFor(logistics, rentalType), optedOutFees) : []),
    [logistics, rentalType, optedOutFees],
  );

  const quote = useMemo(() => {
    if (!rentalType || !bikeModel) return null;
    return computeQuote(logistics, bikeModel, rentalType, orderFees, durationValue);
  }, [logistics, bikeModel, rentalType, orderFees, durationValue]);

  // Stripe's cut, estimated the same way the backend computes it
  // (feeBase * processingFee + transactionFee). Shown up front so the amount held
  // on the card is never a surprise at the payment sheet.
  const assignedProvider = useMemo(
    () => providers.find((p) => p.id === selectedProviderId) ?? null,
    [providers, selectedProviderId],
  );

  const taxRate = assignedProvider?.chargesSalesTax === true
    ? (assignedProvider.salesTaxRate ?? 0)
    : 0;

  const salesTax = useMemo(
    () => (quote ? Math.round(quote.total * taxRate * 100) / 100 : 0),
    [quote, taxRate],
  );

  const ccFee = useMemo(() => {
    if (!quote || !config?.stripe) return 0;
    const feeBase = quote.total + salesTax;
    const fee = feeBase * (config.stripe.processingFee ?? 0) + (config.stripe.transactionFee ?? 0);
    return Math.round(fee * 100) / 100;
  }, [quote, salesTax, config]);

  const grandTotal = useMemo(
    () => (quote ? Math.round((quote.total + salesTax + ccFee) * 100) / 100 : 0),
    [quote, salesTax, ccFee],
  );

  const endDate = useMemo(() => {
    if (!rentalType || rentalType === 'buy' || !durationValue) return null;
    return expectedEndDate(startDate, durationValue, rentalType === 'rent' ? 'weeks' : 'months');
  }, [startDate, rentalType, durationValue]);

  // Next 14 days, starting tomorrow — nothing is delivered same-day.
  const dayOptions = useMemo(() => {
    const first = tomorrowDay();
    return Array.from({ length: 14 }, (_, i) => addDays(first, i));
  }, []);

  const canProceed = (): boolean => {
    switch (step) {
      case 1: return !!startDate && startDate > todayDay();
      case 2: return !!deliveryTime;
      case 3: return !!rentalType;
      case 4: return !!bikeModel && (availabilityFor(bikeModel)?.available ?? 0) > 0;
      case 5: return true;
      case 6: return !!selectedProviderId && !!userProfile?.address;
      default: return false;
    }
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleFinalize = async () => {
    // Never open a payment sheet before the real Stripe publishable key is live —
    // the StripeProvider mounts with a placeholder until it loads. The CTA is also
    // disabled in this state; this is defense-in-depth.
    if (!stripeReady) return;
    if (userProfile?.isBlocked) {
      Alert.alert('Account Suspended', 'Your account is suspended and cannot place orders. Please contact support.');
      return;
    }
    if (!userProfile?.name || !userProfile?.address) {
      Alert.alert(
        'Profile Incomplete',
        'Please set your name and address in your account profile before renting.',
        [{ text: 'Go to Account', onPress: () => navigation.navigate('Account') }],
      );
      return;
    }
    if (!selectedProviderId || !rentalType || !bikeModel || !quote) return;

    setSubmitting(true);
    const orderId = generateOrderId();
    const user = auth().currentUser;
    const provider = providers.find((p) => p.id === selectedProviderId);

    try {
      // The backend re-prices from apiConfig/logistics and is authoritative; the
      // local quote is sent only as a cross-check hint. The deposit is deliberately
      // NOT part of this payment intent — it is secured separately at delivery.
      const createPaymentIntentCall = getFunctionsInstance().httpsCallable('createPaymentIntent');
      const response: any = await createPaymentIntentCall({
        orderId,
        currency: 'usd',
        providerId: selectedProviderId,
        customerAddress: userProfile?.address || 'Address Not Set',
        zipCode: userProfile?.zipCode || provider?.zipCode || '',
        rentalType,
        bikeModel,
        durationValue: quote.durationValue,
        durationUnit: quote.durationUnit,
        fees: orderFees,
        amount: quote.total,
        stripeCustomerId: userProfile?.stripeCustomerId || undefined,
      });

      const { clientSecret, paymentIntentId, pricing = {} } = response.data;
      const savedPaymentMethodId = userProfile?.billingPaymentMethodId;

      if (savedPaymentMethodId) {
        const { error } = await confirmPayment(clientSecret, {
          paymentMethodType: 'Card',
          paymentMethodData: { paymentMethodId: savedPaymentMethodId },
        });
        if (error) { Alert.alert('Payment Error', error.message); return; }
      } else {
        const { error: initError } = await initPaymentSheet({
          merchantDisplayName: 'Foodyzz',
          paymentIntentClientSecret: clientSecret,
          defaultBillingDetails: { phone: user?.phoneNumber || undefined },
          allowsDelayedPaymentMethods: false,
        });
        if (initError) { Alert.alert('Payment Setup Error', initError.message); return; }
        const { error: presentError } = await presentPaymentSheet();
        if (presentError) {
          if (presentError.code !== 'Canceled') Alert.alert('Payment Error', presentError.message);
          return;
        }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

      // Persist the card for reuse + the deposit hold. Best-effort: a failure here
      // must not block the order that was already paid.
      try {
        await getFunctionsInstance().httpsCallable('recordOrderCard')({ orderId });
      } catch (e) {
        console.warn('recordOrderCard failed (non-fatal):', e);
      }

      const total = pricing.total ?? quote.total;
      await db.collection('orders').doc(orderId).set({
        id: orderId,
        customerPhone: user?.phoneNumber,
        customerName: userProfile?.name || 'Customer',
        customerEmail: userProfile?.email || '',
        customerAddress: userProfile?.address || '',
        customerLat: userProfile?.lat ?? null,
        customerLng: userProfile?.lng ?? null,
        zipCode: userProfile?.zipCode || provider?.zipCode || '',

        // Rental specifics
        rentalType,
        bikeModel,
        bikeId: null,               // a physical bike is assigned at delivery
        startDate,
        deliveryTime,
        durationValue: quote.durationValue,
        durationUnit: quote.durationUnit,
        expectedEndDate: endDate,
        baseRate: rateFor(logistics, bikeModel, rentalType),
        fees: orderFees,

        // The deposit is disclosed up front but excluded from this charge; FoodyzzHQ
        // secures it against a saved card at delivery and releases it on Complete.
        depositAmount: quote.depositAmount,
        depositStatus: 'none',
        depositHoldUntil: endDate ? addDays(endDate, 3) : null,

        // Scheduling mirrors — FoodyzzHQ buckets its Delivery / Rental Due tabs off these.
        pickupDay: startDate,
        pickupTimeWindow: deliveryTime,
        handoffDay: startDate,
        handoffTime: deliveryTime,
        needByDay: endDate,
        needBy: endDate ? parseDay(endDate).toISOString() : null,

        notes,
        status: 'requested',
        payoutStatus: 'unpaid',
        paymentIntentId,
        // Nothing is charged until the bike is actually delivered.
        paymentCaptured: false,
        estimatedPrice: total,
        authorizedAmount: total,
        authorizedAt: new Date().toISOString(),
        orderSubtotal: pricing.orderSubtotal ?? quote.total,
        tax: pricing.tax ?? 0,
        taxRate: pricing.taxRate ?? 0,
        ccProcessingFee: pricing.ccProcessingFee ?? 0,
        platformFee: pricing.platformFee ?? null,
        // Rent-to-buy installment plan (server-priced). Delivery seeds the billing
        // schedule from this; absent for rent/buy.
        ...(pricing.rentToBuyPlan ? { rentToBuyPlan: pricing.rentToBuyPlan } : {}),

        providerId: selectedProviderId,
        providerName: provider?.businessName || '',
        createdAt: new Date().toISOString(),
      });

      navigation.navigate('Main', { screen: 'My Rentals' });
    } catch (error: any) {
      console.error('Checkout Error:', error);
      Alert.alert('Error', error.message || 'An unexpected error occurred during checkout.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderModelCard = (model: number) => {
    const m = logistics.bikeModels.find((b) => b.model === model);
    if (!m || !rentalType) return null;
    const avail = availabilityFor(model);
    const soldOut = (avail?.available ?? 0) === 0;
    const selected = bikeModel === model;
    const rate = m.rates[rentalType];
    const commit = minCommitmentFor(logistics, model, rentalType);

    return (
      <TouchableOpacity
        key={model}
        disabled={soldOut}
        onPress={() => setBikeModel(model)}
        className={`border-2 rounded-2xl mb-4 overflow-hidden ${
          selected ? 'border-brand-green bg-orange-50' : 'border-black bg-white'
        } ${soldOut ? 'opacity-60' : 'shadow-brutalist'}`}
      >
        <View className="relative">
          {m.imageUrl ? (
            <Image
              source={{ uri: m.imageUrl }}
              className="w-full h-40"
              resizeMode="cover"
              style={soldOut ? { opacity: 0.35 } : undefined}
            />
          ) : (
            <View
              className="w-full h-40 bg-slate-100 items-center justify-center"
              style={soldOut ? { opacity: 0.35 } : undefined}
            >
              <BikeIcon size={48} color="#94a3b8" />
            </View>
          )}
          {/* SOLD OUT watermark — a bike with no available stock can't be selected
              (the card is disabled), and this makes that unmistakable at a glance. */}
          {soldOut && (
            <View className="absolute inset-0 items-center justify-center">
              <View
                style={{ transform: [{ rotate: '-12deg' }] }}
                className="bg-red-600 px-6 py-2 border-2 border-white rounded-md"
              >
                <Text className="text-white font-black text-2xl uppercase tracking-widest">
                  Sold Out
                </Text>
              </View>
            </View>
          )}
        </View>
        <View className="p-4">
          <View className="flex-row items-start justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Model {m.model}
              </Text>
              <Text className="text-lg font-black text-slate-800 uppercase">{m.name}</Text>
            </View>
            <View className="items-end">
              <Text className="text-2xl font-black text-brand-green-dark">${rate.toFixed(2)}</Text>
              <Text className="text-[10px] font-bold text-slate-400 uppercase">
                {rentalType === 'rent' ? 'per week' : rentalType === 'rentToBuy' ? 'per month' : 'one time'}
              </Text>
            </View>
          </View>

          {commit && (
            <Text className="mt-2 text-xs font-bold text-slate-500">
              Minimum {commit.value} {commit.unit}
            </Text>
          )}

          {soldOut && (
            <View className="mt-3 border-2 border-red-200 bg-red-50 rounded-xl px-3 py-2">
              <Text className="text-[11px] font-bold text-red-500">
                {avail?.nextAvailableDate
                  ? `Expected back ${dayLabel(avail.nextAvailableDate)}`
                  : 'No bikes of this model are in stock right now.'}
              </Text>
            </View>
          )}

          {selected && (
            <View className="mt-3 flex-row items-center">
              <Check size={16} color="#507425" />
              <Text className="ml-1 text-xs font-black text-brand-green-dark uppercase">Selected</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const stepLabel = step === 1 && rentalType === 'buy' ? 'Need by' : STEP_TITLES[step - 1];
  // On the pay step, hold the CTA until the real Stripe key is live (see stripeReady).
  const payBlocked = step === 6 && !stripeReady;

  return (
    <View className="flex-1 bg-slate-50">
      {/* Progress */}
      <View className="px-5 pt-4 pb-3 bg-white border-b-2 border-black">
        <Text className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
          Step {currentIdx + 1} of {stepSequence.length} · {stepLabel}
        </Text>
        <View className="flex-row mt-2">
          {stepSequence.map((s, i) => (
            <View
              key={s}
              className={`flex-1 h-1.5 mr-1 rounded-full ${i <= currentIdx ? 'bg-brand-green' : 'bg-slate-100'}`}
            />
          ))}
        </View>
      </View>

      <ScrollView className="flex-1 px-5 pt-5" showsVerticalScrollIndicator={false}>
        {/* 1 — Start date */}
        {step === 1 && (
          <View>
            <View className="flex-row items-center mb-1">
              <Calendar size={20} color="#507425" />
              <Text className="ml-2 text-xl font-black text-slate-800 uppercase">
                {rentalType === 'buy' ? 'When do you need it by?' : 'When do you start?'}
              </Text>
            </View>
            <Text className="text-xs font-bold text-slate-400 mb-4">
              {rentalType === 'buy'
                ? 'Pick the day you want your new bike delivered. Tomorrow is the earliest.'
                : 'Rentals begin the day your bike is delivered. Tomorrow is the earliest.'}
            </Text>
            <View className="flex-row flex-wrap">
              {dayOptions.map((day) => (
                <TouchableOpacity
                  key={day}
                  onPress={() => setStartDate(day)}
                  className={`px-4 py-3 mr-2 mb-2 rounded-xl border-2 ${
                    startDate === day ? 'border-brand-green bg-orange-50' : 'border-black bg-white'
                  }`}
                >
                  <Text className={`text-xs font-black uppercase ${startDate === day ? 'text-brand-green-dark' : 'text-slate-700'}`}>
                    {day === tomorrowDay() ? 'Tomorrow' : dayLabel(day)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* 2 — Delivery time */}
        {step === 2 && (
          <View>
            <View className="flex-row items-center mb-1">
              <Clock size={20} color="#507425" />
              <Text className="ml-2 text-xl font-black text-slate-800 uppercase">Delivery time</Text>
            </View>
            <Text className="text-xs font-bold text-slate-400 mb-4">
              Pick a window on {dayLabel(startDate)}. FoodyzzHQ confirms the exact time when they accept.
            </Text>
            {slots.map((slot) => (
              <TouchableOpacity
                key={slot}
                onPress={() => setDeliveryTime(slot)}
                className={`flex-row items-center justify-between px-4 py-4 mb-3 rounded-2xl border-2 ${
                  deliveryTime === slot ? 'border-brand-green bg-orange-50' : 'border-black bg-white shadow-brutalist'
                }`}
              >
                <Text className={`font-black uppercase ${deliveryTime === slot ? 'text-brand-green-dark' : 'text-slate-700'}`}>
                  {slot}
                </Text>
                {deliveryTime === slot && <Check size={18} color="#507425" />}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* 3 — Rental type */}
        {step === 3 && (
          <View>
            <View className="flex-row items-center mb-1">
              <BikeIcon size={20} color="#507425" />
              <Text className="ml-2 text-xl font-black text-slate-800 uppercase">Select one</Text>
            </View>
            <Text className="text-xs font-bold text-slate-400 mb-4">How would you like to take it?</Text>
            {RENTAL_TYPES.map((t) => (
              <TouchableOpacity
                key={t.key}
                onPress={() => {
                  setRentalType(t.key);
                  // Availability pools differ per type, so a stale model pick can be
                  // invalid under the new type — clear it and let step 4 re-choose.
                  setBikeModel(null);
                  setDurationValue(0);
                }}
                className={`px-4 py-4 mb-3 rounded-2xl border-2 ${
                  rentalType === t.key ? 'border-brand-green bg-orange-50' : 'border-black bg-white shadow-brutalist'
                }`}
              >
                <Text className={`font-black uppercase ${rentalType === t.key ? 'text-brand-green-dark' : 'text-slate-800'}`}>
                  {t.label}
                </Text>
                <Text className="text-[11px] font-bold text-slate-400 mt-1">{t.blurb}</Text>
              </TouchableOpacity>
            ))}

            {/* Certification / compliance note — applies to every bike regardless of type */}
            <View className="mt-2 px-4 py-4 rounded-2xl bg-slate-50 border border-slate-200">
              <View className="flex-row items-center mb-2">
                <ShieldCheck size={16} color="#507425" />
                <Text className="ml-2 text-xs font-black text-slate-700 uppercase">Certifications</Text>
              </View>
              <Text className="text-[11px] font-bold text-slate-500 leading-4">
                The bike electrical system is UL 2849 certified — the certification mark is displayed on the frame.{'\n'}
                The battery is UL 2271 certified.{'\n'}
                IP Rating: IP65 (dust and splash resistant){'\n'}
                Frame loading: can load 300 lbs
              </Text>
              <Text className="text-[11px] font-bold text-slate-400 mt-2">
                Contact compliance@foodyzz.com for details
              </Text>
            </View>

            {/* Battery / performance specs — applies to every bike regardless of type */}
            <View className="mt-3 px-4 py-4 rounded-2xl bg-slate-50 border border-slate-200">
              <View className="flex-row items-center mb-2">
                <BikeIcon size={16} color="#507425" />
                <Text className="ml-2 text-xs font-black text-slate-700 uppercase">Battery & Performance</Text>
              </View>
              <Text className="text-[11px] font-bold text-slate-500 leading-4">
                The battery is removable.{'\n'}
                Top speed: 21 mph{'\n'}
                Distance per charge: 80 km (50 miles) with pedal assistance in eco mode{'\n'}
                Integrated battery management system (BMS)
              </Text>
            </View>
          </View>
        )}

        {/* 4 — Model */}
        {step === 4 && (
          <View>
            <Text className="text-xl font-black text-slate-800 uppercase mb-1">Choose your bike</Text>
            <Text className="text-xs font-bold text-slate-400 mb-4">
              {rentalType === 'rent'
                ? 'New and used bikes are both available to rent.'
                : 'Rent to Buy and Buy always start with a new bike.'}
            </Text>
            {bikesLoading ? (
              <ActivityIndicator className="mt-8" color="#507425" />
            ) : (
              logistics.bikeModels.map((m) => renderModelCard(m.model))
            )}

            {/* Term selection — the customer may commit to more than the minimum. */}
            {bikeModel && commitment && (
              <View className="border-2 border-black rounded-2xl bg-white p-4 mb-6 shadow-brutalist">
                <Text className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Commitment ({commitment.unit})
                </Text>
                <View className="flex-row items-center justify-between mt-2">
                  <TouchableOpacity
                    onPress={() => setDurationValue((v) => Math.max(commitment.value, v - 1))}
                    className="w-11 h-11 border-2 border-black rounded-xl items-center justify-center bg-white"
                  >
                    <Text className="text-xl font-black">−</Text>
                  </TouchableOpacity>
                  <Text className="text-2xl font-black text-slate-800">
                    {durationValue} <Text className="text-sm text-slate-400 uppercase">{commitment.unit}</Text>
                  </Text>
                  <TouchableOpacity
                    onPress={() => setDurationValue((v) => v + 1)}
                    className="w-11 h-11 border-2 border-black rounded-xl items-center justify-center bg-white"
                  >
                    <Text className="text-xl font-black">+</Text>
                  </TouchableOpacity>
                </View>
                <Text className="text-[11px] font-bold text-slate-400 mt-2">
                  Minimum {commitment.value} {commitment.unit}
                  {endDate ? ` · ends ${dayLabel(endDate)}` : ''}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* 5 — Fees (never shown for Buy) */}
        {step === 5 && rentalType !== 'buy' && (
          <View>
            <View className="flex-row items-center mb-1">
              <ShieldCheck size={20} color="#507425" />
              <Text className="ml-2 text-xl font-black text-slate-800 uppercase">Rental fees</Text>
            </View>
            <Text className="text-xs font-bold text-slate-400 mb-4">
              So there are no surprises — here is everything that comes with your rental.
            </Text>

            {orderFees.map((fee) => {
              const locked = fee.required;
              // The deposit is always secured at delivery (see computeQuote/isDeposit),
              // so it can never be opted out — even when its `required` flag is false.
              const isDeposit = fee.key === 'deposit';
              const uiLocked = locked || isDeposit;
              return (
                <TouchableOpacity
                  key={fee.key}
                  disabled={uiLocked}
                  onPress={() =>
                    setOptedOutFees((prev) =>
                      prev.includes(fee.key) ? prev.filter((k) => k !== fee.key) : [...prev, fee.key],
                    )
                  }
                  className={`flex-row items-center justify-between px-4 py-4 mb-3 rounded-2xl border-2 ${
                    fee.accepted ? 'border-black bg-white shadow-brutalist' : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <View className="flex-1 pr-3">
                    <Text className="font-black text-slate-800 uppercase text-sm">{fee.label}</Text>
                    <Text className="text-[11px] font-bold text-slate-400 mt-0.5">
                      {fee.cadence === 'weekly' ? 'Billed weekly' : fee.cadence === 'monthly' ? 'Billed monthly' : 'One time'}
                      {isDeposit ? '' : locked ? ' · Required' : ' · Optional'}
                      {isDeposit ? ' · Refundable, not charged today' : ''}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="font-black text-slate-800">${fee.amount.toFixed(2)}</Text>
                    <Text className={`text-[10px] font-black uppercase mt-0.5 ${fee.accepted ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {fee.key === 'deposit' ? 'At delivery' : locked ? 'Included' : fee.accepted ? 'Added' : 'Opted out'}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}

            <View className="border-2 border-indigo-200 bg-indigo-50 rounded-2xl p-4 mb-6">
              <View className="flex-row items-center mb-2">
                <Info size={16} color="#4338ca" />
                <Text className="ml-2 text-[11px] font-black text-indigo-800 uppercase tracking-wide">
                  How and when you are charged
                </Text>
              </View>

              <View className="flex-row items-start mb-2">
                <Text className="text-[11px] font-black text-indigo-700 w-4">1.</Text>
                <Text className="flex-1 text-[11px] font-bold text-indigo-700">
                  When you request this rental we place a <Text className="font-black">hold</Text> on your card for
                  the rental and fees — nothing is charged yet. You can cancel free of charge any time before delivery.
                </Text>
              </View>

              <View className="flex-row items-start mb-2">
                <Text className="text-[11px] font-black text-indigo-700 w-4">2.</Text>
                <Text className="flex-1 text-[11px] font-bold text-indigo-700">
                  On delivery you will see <Text className="font-black">two separate transactions</Text>: the bike
                  rental and fees are charged, and the ${quote?.depositAmount.toFixed(2) ?? '0.00'} security deposit
                  is <Text className="font-black">charged</Text>.
                </Text>
              </View>

              <View className="flex-row items-start">
                <Text className="text-[11px] font-black text-indigo-700 w-4">3.</Text>
                <Text className="flex-1 text-[11px] font-bold text-indigo-700">
                  The deposit is charged at delivery and <Text className="font-black">refunded when you return the
                  bike</Text>, minus any adjustments for damage.
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* 6 — Location, review, pay */}
        {step === 6 && (
          <View>
            <View className="flex-row items-center mb-1">
              <MapPin size={20} color="#507425" />
              <Text className="ml-2 text-xl font-black text-slate-800 uppercase">Bike delivery location</Text>
            </View>
            <Text className="text-xs font-bold text-slate-400 mb-4">
              Your bike is delivered to you — we bring it to the address on your account.
            </Text>

            <View className="border-2 border-black rounded-2xl bg-white p-4 mb-4 shadow-brutalist">
              <Text className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                Delivering to
              </Text>
              <Text className="font-black text-slate-800">{userProfile?.name || 'Your address'}</Text>
              <Text className="text-[11px] font-bold text-slate-500 mt-0.5">
                {userProfile?.address || 'Add your address in Account before ordering.'}
              </Text>
            </View>

            {/* Summary */}
            {quote && bikeModel && rentalType && (
              <View className="border-2 border-black rounded-2xl bg-white p-4 mb-4 shadow-brutalist">
                <Text className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Your rental</Text>
                <SummaryRow label="Bike" value={logistics.bikeModels.find((m) => m.model === bikeModel)?.name || `Model ${bikeModel}`} />
                <SummaryRow label="Type" value={RENTAL_TYPES.find((t) => t.key === rentalType)?.label || ''} />
                <SummaryRow label="Starts" value={dayLabel(startDate)} />
                <SummaryRow label="Delivery" value={deliveryTime} />
                {rentalType !== 'buy' && (
                  <>
                    <SummaryRow label="Term" value={`${quote.durationValue} ${quote.durationUnit}`} />
                    {endDate && <SummaryRow label="Ends" value={dayLabel(endDate)} />}
                    <SummaryRow
                      label="Rate"
                      value={`$${quote.baseRate.toFixed(2)} / ${quote.durationUnit === 'weeks' ? 'week' : 'month'}`}
                    />
                    {quote.recurringFees > 0 && (
                      <SummaryRow label="Fees" value={`$${quote.recurringFees.toFixed(2)} per period`} />
                    )}
                  </>
                )}
                <View className="h-px bg-slate-200 my-2" />
                <SummaryRow
                  label={rentalType === 'rentToBuy' ? 'First month + fees' : 'Rental + fees'}
                  value={`$${quote.total.toFixed(2)}`}
                />
                {salesTax + ccFee > 0 && (
                  <SummaryRow label="Taxes and fees" value={`$${(salesTax + ccFee).toFixed(2)}`} />
                )}
                <View className="h-px bg-slate-200 my-2" />
                <View className="flex-row items-center justify-between">
                  <Text className="font-black text-slate-800 uppercase">
                    {rentalType === 'rentToBuy' ? 'Due at delivery' : 'On hold today'}
                  </Text>
                  <Text className="text-xl font-black text-brand-green-dark">${grandTotal.toFixed(2)}</Text>
                </View>
                {rentalType === 'rentToBuy' ? (
                  <>
                    <View className="bg-pink-50 border border-pink-200 rounded-xl p-3 mt-3">
                      <Text className="text-[11px] font-black text-pink-700 uppercase tracking-wide mb-1">
                        Rent-to-buy plan
                      </Text>
                      <Text className="text-[12px] font-bold text-slate-600">
                        ${grandTotal.toFixed(2)}/month for {quote.durationValue} months, then the bike is yours.
                        The first month is charged at delivery; the rest are billed automatically each month to
                        your saved card.
                      </Text>
                      <View className="flex-row items-center justify-between mt-2 pt-2 border-t border-pink-200">
                        <Text className="text-[11px] font-black text-slate-500 uppercase">Total over {quote.durationValue} months</Text>
                        <Text className="text-sm font-black text-slate-800">
                          ${(grandTotal * quote.durationValue).toFixed(2)}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-[11px] font-bold text-slate-400 mt-2">
                      You can pay off the remaining balance early any time from My Rentals.
                    </Text>
                  </>
                ) : (
                  <Text className="text-[11px] font-bold text-slate-400 mt-1">
                    Held on your card now, charged when your bike is delivered. Cancel free any time before then.
                  </Text>
                )}
                {quote.depositAmount > 0 && (
                  <Text className="text-[11px] font-bold text-slate-400 mt-1">
                    The ${quote.depositAmount.toFixed(2)} security deposit is a separate charge at delivery, refunded
                    when you {rentalType === 'rentToBuy' ? 'own the bike' : 'return the bike'}.
                  </Text>
                )}
              </View>
            )}

            <Text className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Notes (optional)</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Gate code, building, anything the rider should know"
              multiline
              className="border-2 border-black rounded-2xl bg-white px-4 py-3 mb-8 font-bold text-slate-700 min-h-[80px]"
            />
          </View>
        )}
      </ScrollView>

      {/* Footer */}
      <View className="px-5 py-4 bg-white border-t-2 border-black flex-row">
        {currentIdx > 0 && (
          <TouchableOpacity
            onPress={goBack}
            className="px-6 py-4 mr-3 rounded-2xl border-2 border-black bg-white"
          >
            <Text className="font-black uppercase text-slate-700">Back</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          disabled={!canProceed() || submitting || payBlocked}
          onPress={step === 6 ? handleFinalize : goNext}
          className={`flex-1 py-4 rounded-2xl border-2 border-black items-center justify-center ${
            canProceed() && !submitting && !payBlocked ? 'bg-brand-green shadow-brutalist' : 'bg-slate-200'
          }`}
        >
          {submitting ? (
            <ActivityIndicator color="#000000" />
          ) : (
            <View className="flex-row items-center">
              {/* Black ink on the brand green (8.7:1) — white would be 2.4:1. */}
              {step === 6 && <CreditCard size={18} color="#000000" />}
              <Text className={`font-black uppercase ${canProceed() && !payBlocked ? 'text-black' : 'text-slate-400'} ${step === 6 ? 'ml-2' : ''}`}>
                {step === 6
                  ? (payBlocked ? 'Preparing secure checkout…' : `Hold my bike · $${grandTotal.toFixed(2)}`)
                  : 'Next'}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-1">
      <Text className="text-xs font-bold text-slate-400 uppercase">{label}</Text>
      <Text className="text-xs font-black text-slate-700">{value}</Text>
    </View>
  );
}
