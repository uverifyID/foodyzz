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
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Image, TextInput,
  KeyboardAvoidingView, Linking,
} from 'react-native';
import { Bike as BikeIcon, Calendar, Clock, MapPin, ShieldCheck, Check, CreditCard, Info, Ticket, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
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
  fetchModelDemand,
  modelAvailability,
  minCommitmentFor,
  rateFor,
  feesFor,
  toOrderFees,
  computeQuote,
} from '../services/logistics';
import type { PendingDemand } from '../services/logistics';
import {
  normalizeCouponCode,
  lookupPromoByCode,
  checkPromoForOrder,
  promoDiscountFor,
  promoDiscountLabel,
} from '../services/promos';
import type { Bike, LogisticsConfig, PromoCampaign, RentalType } from '../types';
import { useUserProfile } from '../context/UserProfileContext';
import { useStripeReady } from '../context/StripeReadyContext';
import { friendlyError, friendlyPaymentError, friendlyServerMessage, logHandledError } from '../services/errors';

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

// The published Terms this screen's acknowledgements correspond to — stored on the order
// so a dispute is answered with the version the rider actually saw, not today's.
const TERMS_VERSION = '2026-08-07';

export default function OrderWizard() {
  const navigation = useNavigation<any>();
  // Presented as a stack modal, so it fills the window and its fixed footer is
  // the last thing above the nav bar.
  const { bottom } = useSafeAreaInsets();
  // Home's "Apply to Next Order" opens the wizard with the promo's code and the type
  // it was minted for, so tapping an offer starts the matching transaction and the
  // code is already waiting on the confirm step.
  const route = useRoute<any>();
  const { initialCouponCode, initialOfferType } = (route.params ?? {}) as {
    initialCouponCode?: string;
    initialOfferType?: RentalType;
  };
  const { initPaymentSheet, presentPaymentSheet, confirmPayment } = useStripe();
  const scrollRef = useRef<ScrollView>(null);
  // False until the real Stripe publishable key has replaced the placeholder the
  // StripeProvider mounts with — gates the pay CTA so checkout can't open against it.
  const stripeReady = useStripeReady();

  // Rental type is the first step (step id 3) so the date step can adapt its label —
  // Buy asks "when do you need it by?" instead of "when do you start?".
  const [step, setStep] = useState(3);
  // One order id for the whole wizard session, not one per pay attempt: the promo
  // claim the backend takes out is bound to this id, so a retry after a declined card
  // has to come back under the same id or it reads as a second checkout on the code.
  const orderIdRef = useRef<string | null>(null);
  const [config, setConfig] = useState<any>(null);
  const [logistics, setLogistics] = useState<LogisticsConfig>(DEFAULT_LOGISTICS);
  // Customer profile from the shared single listener (UserProfileContext) instead of
  // a duplicate per-screen users/{phone} onSnapshot.
  const { profile: userProfile } = useUserProfile();
  const [bikes, setBikes] = useState<Bike[]>([]);
  const [bikesLoading, setBikesLoading] = useState(true);
  // Orders already queued per model with no bike assigned yet — see fetchModelDemand.
  const [pendingDemand, setPendingDemand] = useState<PendingDemand>({});

  // ── Selections ────────────────────────────────────────────────────────────
  const [startDate, setStartDate] = useState<string>(tomorrowDay());
  const [deliveryTime, setDeliveryTime] = useState<string>('');
  // Preselect the type an incoming promo is for, so the code it arrived with actually
  // has a matching transaction to land on. The customer can still change it — the
  // coupon comes back off if they do (see the re-check effect below).
  const [rentalType, setRentalType] = useState<RentalType | null>(
    initialOfferType && RENTAL_TYPES.some((t) => t.key === initialOfferType) ? initialOfferType : null,
  );
  const [bikeModel, setBikeModel] = useState<number | null>(null);
  // Optional fees the customer switched ON. Only possible for `required: false` fees,
  // and always an affirmative tap — an optional recurring charge is never pre-selected.
  const [selectedFees, setSelectedFees] = useState<string[]>([]);
  // Checkout acknowledgements. Both are conditions of the rental, so both gate the pay
  // button rather than sitting under it as text the rider can scroll past.
  const [ackSafety, setAckSafety] = useState(false);
  const [ackTerms, setAckTerms] = useState(false);
  // Committed term. Seeded from the model's minimum and never allowed below it.
  const [durationValue, setDurationValue] = useState<number>(0);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [providers, setProviders] = useState<any[]>([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ── Promo code ────────────────────────────────────────────────────────────
  // Prefilled when the wizard was opened from an offer card; otherwise typed or
  // pasted on the confirm step. `appliedPromo` is only ever set by a promo that
  // passed every check — above all that its offerType IS this rental type.
  const [couponInput, setCouponInput] = useState(
    initialCouponCode ? normalizeCouponCode(initialCouponCode) : '',
  );
  const [appliedPromo, setAppliedPromo] = useState<PromoCampaign | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);
  // The incoming code we've already auto-applied, so clearing it by hand sticks and a
  // fresh offer tapped later still gets its turn.
  const autoAppliedRef = useRef<string | null>(null);

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
  //
  // Queued demand is read on the same schedule and in the same pass. The two are
  // fetched together because they are only meaningful together — a bike count without
  // the orders already queued against it is the overselling bug this guards.
  useEffect(() => {
    let cancelled = false;
    setBikesLoading(true);
    Promise.all([
      fetchBikes().catch((e) => { console.warn('fetchBikes failed:', e); return [] as Bike[]; }),
      // A failure here must not block checkout. Falling back to zero demand restores
      // exactly the pre-waitlist behaviour rather than stranding every model in a
      // waitlist the customer cannot escape.
      fetchModelDemand().catch((e) => { console.warn('fetchModelDemand failed:', e); return {} as PendingDemand; }),
    ])
      .then(([b, d]) => {
        if (cancelled) return;
        setBikes(b);
        setPendingDemand(d);
      })
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
      modelAvailability(bikes, logistics, m.model, rentalType, startDate, pendingDemand[String(m.model)] ?? 0),
    );
  }, [bikes, logistics, rentalType, startDate, pendingDemand]);

  const availabilityFor = useCallback(
    (model: number) => availability.find((a) => a.model === model),
    [availability],
  );

  // Whether the bike being checked out is coming off the waitlist. Read at submit to
  // flag the order for HQ and to tell the customer their order needs confirming.
  const isWaitlistOrder = useMemo(
    () => !!(bikeModel && availabilityFor(bikeModel)?.waitlist),
    [bikeModel, availabilityFor],
  );

  const orderFees = useMemo(
    () => (rentalType ? toOrderFees(feesFor(logistics, rentalType), selectedFees) : []),
    [logistics, rentalType, selectedFees],
  );


  // What the Fees step lists. The deposit is dropped from the LIST only — it is not a
  // rental fee, it is refundable, and leading with it made the step open on a charge
  // the customer never actually pays. It is still disclosed twice below: in the "how
  // and when you are charged" panel and again on the confirm step.
  //
  // `orderFees` itself is deliberately untouched — that array is what createPaymentIntent
  // re-prices against and what is written to the order, so filtering it would change
  // what the backend sees, not just what the screen shows. Memoised so the step does
  // not rebuild the array on every render.
  const listedFees = useMemo(() => orderFees.filter((f) => f.key !== 'deposit'), [orderFees]);

  const quote = useMemo(() => {
    if (!rentalType || !bikeModel) return null;
    return computeQuote(logistics, bikeModel, rentalType, orderFees, durationValue);
  }, [logistics, bikeModel, rentalType, orderFees, durationValue]);

  // Rental-purchase disclosures (NY Personal Property Law § 501(7)(a)): the cash price,
  // the number of payments, and the total of payments needed to own — stated before the
  // customer commits, not buried in an agreement.
  //
  // `noFinanceCharge` is COMPUTED, never assumed. A rent-to-buy plan may only be called
  // interest-free where the total actually payable to acquire ownership does not exceed
  // the cash price, and that comparison includes every required fee, because a required
  // fee is money the customer must pay to get there. Where the total runs over, the
  // screen states the difference instead — a "0% interest" badge on a plan that costs
  // more than the bike is the exact claim NY treats as deceptive.
  const rtoTerms = useMemo(() => {
    if (rentalType !== 'rentToBuy' || !quote || !bikeModel) return null;
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const months = quote.durationValue;
    // Pre-tax, so it compares like-for-like against the cash price.
    const perMonth = round2(quote.perPeriodSubtotal ?? quote.total);
    const totalOfPayments = round2(perMonth * months);
    const cashPrice = rateFor(logistics, bikeModel, 'buy');
    return {
      months,
      perMonth,
      totalOfPayments,
      cashPrice,
      difference: round2(Math.abs(totalOfPayments - cashPrice)),
      noFinanceCharge: cashPrice > 0 && totalOfPayments <= cashPrice,
    };
  }, [rentalType, quote, bikeModel, logistics]);

  // Wording for the fees step. A fee's `cadence` is the unit its RATE is quoted in, not
  // how often the card is charged — computeQuote bills plain rent as rate × term plus the
  // fee bundle ONCE, all in a single charge at delivery, and rent-to-buy repeats rate +
  // the same bundle on every installment. "Billed weekly" next to a 4-week charge read as
  // four weekly debits, so the step now names the period the customer actually pays for.
  const isInstalmentPlan = rentalType === 'rentToBuy';
  const unitLabel = quote?.durationUnit === 'months' ? 'month' : 'week';
  // "4-week" / "1 week" — the term the single charge covers.
  const termLabel = quote ? `${quote.durationValue}-${unitLabel}` : '';

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

  // What the promo takes off the rental. Sales tax and the card fee are deliberately
  // left on the pre-discount base — that is how computePricing prices it server-side,
  // and the amount shown here has to be the amount actually authorized.
  const couponDiscount = useMemo(
    () => (quote ? promoDiscountFor(appliedPromo, quote.total) : 0),
    [appliedPromo, quote],
  );

  // The undiscounted charge for one period. A coupon only ever comes off the payment
  // taken at checkout, so the rent-to-buy plan quotes its installments from this.
  const totalBeforeCoupon = useMemo(
    () => (quote ? Math.round((quote.total + salesTax + ccFee) * 100) / 100 : 0),
    [quote, salesTax, ccFee],
  );

  const grandTotal = useMemo(() => {
    if (!quote) return 0;
    const total = Math.max(0, quote.total - couponDiscount) + salesTax + ccFee;
    // Stripe won't hold less than $0.50, and the backend clamps up to it — a coupon
    // that eats the whole rental is the one case that reaches the floor, so mirror it
    // rather than promise a total the card is never charged.
    return Math.max(Math.round(total * 100) / 100, 0.5);
  }, [quote, couponDiscount, salesTax, ccFee]);

  const endDate = useMemo(() => {
    if (!rentalType || rentalType === 'buy' || !durationValue) return null;
    return expectedEndDate(startDate, durationValue, rentalType === 'rent' ? 'weeks' : 'months');
  }, [startDate, rentalType, durationValue]);

  // Next 14 days, starting tomorrow — nothing is delivered same-day.
  const dayOptions = useMemo(() => {
    const first = tomorrowDay();
    return Array.from({ length: 14 }, (_, i) => addDays(first, i));
  }, []);

  // ── Promo code ────────────────────────────────────────────────────────────
  const redeemedPromoIds = userProfile?.redeemedPromoIds;

  // Only the newest lookup may write state. Two taps in a row against different codes
  // resolve in whatever order the network decides, and without this the slower one
  // wins — leaving a discount on screen for a code the customer replaced.
  const couponRequestRef = useRef(0);

  const applyCoupon = useCallback(async (rawCode: string) => {
    const code = normalizeCouponCode(rawCode);
    if (!code) {
      setAppliedPromo(null);
      setCouponError('Enter a promo code.');
      return;
    }
    const requestId = ++couponRequestRef.current;
    const isStale = () => couponRequestRef.current !== requestId;
    setCouponChecking(true);
    setCouponError(null);
    try {
      const promo = await lookupPromoByCode(code);
      if (isStale()) return;
      // The gate that matters: a code minted for Rent is refused on Rent to Buy and
      // Buy, and vice versa. checkPromoForOrder also covers expiry and prior use — the
      // backend re-runs all of it before it authorizes anything.
      const check = checkPromoForOrder(promo, rentalType, redeemedPromoIds);
      if (!check.ok || !promo) {
        setAppliedPromo(null);
        setCouponError(check.message ?? "That promo code isn't valid.");
        return;
      }
      setAppliedPromo(promo);
      setCouponInput(code);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      if (isStale()) return;
      console.warn('promo lookup failed:', e);
      setAppliedPromo(null);
      setCouponError("We couldn't check that code. Try again.");
    } finally {
      if (!isStale()) setCouponChecking(false);
    }
  }, [rentalType, redeemedPromoIds]);

  const clearCoupon = useCallback(() => {
    // Retires any lookup still in flight, so one landing after this can't re-apply.
    couponRequestRef.current++;
    setAppliedPromo(null);
    setCouponInput('');
    setCouponError(null);
    setCouponChecking(false);
  }, []);

  // A code carried in from an offer card applies itself once the customer reaches the
  // confirm step — by then the rental type is settled, so the match is decided against
  // what they are actually buying rather than against a half-built order.
  useEffect(() => {
    const incoming = initialCouponCode ? normalizeCouponCode(initialCouponCode) : '';
    if (!incoming || autoAppliedRef.current === incoming) return;
    // Show it in the field on the way there; only spend the one auto-apply once the
    // rental type is settled and the customer is actually looking at the total.
    setCouponInput(incoming);
    if (step !== 6 || !rentalType) return;
    autoAppliedRef.current = incoming;
    applyCoupon(incoming);
  }, [step, initialCouponCode, rentalType, applyCoupon]);

  // Going back and switching the rental type invalidates a code bound to the old one.
  // Drop it rather than carry a discount the backend would refuse at payment.
  useEffect(() => {
    if (!appliedPromo) return;
    const check = checkPromoForOrder(appliedPromo, rentalType, redeemedPromoIds);
    if (!check.ok) {
      setAppliedPromo(null);
      setCouponError(check.message ?? 'That promo code no longer applies to this order.');
    }
  }, [appliedPromo, rentalType, redeemedPromoIds]);

  const canProceed = (): boolean => {
    switch (step) {
      case 1: return !!startDate && startDate > todayDay();
      case 2: return !!deliveryTime;
      case 3: return !!rentalType;
      case 4: return !!bikeModel && (availabilityFor(bikeModel)?.available ?? 0) > 0;
      case 5: return true;
      case 6: return !!selectedProviderId && !!userProfile?.address && ackSafety && ackTerms;
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
    if (!orderIdRef.current) orderIdRef.current = generateOrderId();
    const orderId = orderIdRef.current;
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
        // The backend re-validates the code against this order's rental type and
        // claims it for single use before it authorizes anything; the discount it
        // returns — not the one displayed — is what gets stored.
        couponCode: appliedPromo?.offerCode || undefined,
        stripeCustomerId: userProfile?.stripeCustomerId || undefined,
      });

      const { clientSecret, paymentIntentId, pricing = {} } = response.data;
      const savedPaymentMethodId = userProfile?.billingPaymentMethodId;

      if (savedPaymentMethodId) {
        const { error } = await confirmPayment(clientSecret, {
          paymentMethodType: 'Card',
          paymentMethodData: { paymentMethodId: savedPaymentMethodId },
        });
        if (error) { Alert.alert('Payment Error', friendlyPaymentError(error, 'That payment did not go through. Please try again.')); return; }
      } else {
        const { error: initError } = await initPaymentSheet({
          merchantDisplayName: 'Foodyzz',
          paymentIntentClientSecret: clientSecret,
          defaultBillingDetails: { phone: user?.phoneNumber || undefined },
          allowsDelayedPaymentMethods: false,
        });
        if (initError) { Alert.alert('Payment Setup Error', friendlyPaymentError(initError, 'We could not start the payment. Please try again.')); return; }
        const { error: presentError } = await presentPaymentSheet();
        if (presentError) {
          if (presentError.code !== 'Canceled') Alert.alert('Payment Error', friendlyPaymentError(presentError, 'That payment did not go through. Please try again.'));
          return;
        }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

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
        // Placed against stock that was already fully claimed by earlier orders. HQ
        // must confirm it can be fulfilled before this one gets a bike; nothing is
        // captured until delivery, so an order it cannot honour is cancelled clean.
        waitlisted: isWaitlistOrder,
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
        // What the rider actually agreed to at checkout, stored with the order so it
        // survives a later change to the Terms or to the wizard's copy.
        acknowledgements: {
          helmetOnEveryRide: true,
          speedLimitMph: 15,
          batteryChargingRules: true,
          commercialUse: true,
          termsVersion: TERMS_VERSION,
          acceptedAt: new Date().toISOString(),
        },
        status: 'requested',
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
        // Server-priced coupon. couponPromoId is what onOrderCreatedRedeemPromo uses to
        // confirm the redemption, so the code can never be spent again.
        couponCode: pricing.couponCode ?? null,
        couponDiscount: pricing.couponDiscount ?? null,
        couponPromoId: pricing.couponPromoId ?? null,
        // Rent-to-buy installment plan (server-priced). Delivery seeds the billing
        // schedule from this; absent for rent/buy.
        ...(pricing.rentToBuyPlan ? { rentToBuyPlan: pricing.rentToBuyPlan } : {}),

        providerId: selectedProviderId,
        providerName: provider?.businessName || '',
        createdAt: new Date().toISOString(),
      });

      // Copy the card just used onto the customer's profile, so it shows under Account
      // > Payment Method and is reused for the deposit hold, rent-to-buy installments
      // and the next order. Must run AFTER the order write — recordOrderCard reads
      // orders/{orderId} to find the PaymentIntent, and returns saved:false if it is
      // not there yet. Best-effort: a failure must not fail an order already paid for.
      try {
        await getFunctionsInstance().httpsCallable('recordOrderCard')({ orderId });
      } catch (e) {
        console.warn('recordOrderCard failed (non-fatal):', e);
      }

      // Release the id now that it belongs to a real order. Held across FAILED attempts
      // so a retry keeps its promo claim, but a second order started from a wizard the
      // customer never unmounted must not write over the one they just placed.
      orderIdRef.current = null;

      // A waitlisted order is not a confirmed one. Say so before the customer lands on
      // My Rentals, where it otherwise looks like every other order awaiting pickup.
      if (isWaitlistOrder) {
        Alert.alert(
          'Added to Waitlist',
          'Admin will confirm if this order can be fulfilled.',
          [{ text: 'OK', onPress: () => navigation.navigate('Main', { screen: 'My Rentals' }) }],
          { cancelable: false },
        );
        return;
      }

      navigation.navigate('Main', { screen: 'My Rentals' });
    } catch (error: any) {
      logHandledError('checkout', error);
      // A code the backend refused (wrong type, expired, or already spent) has to come
      // off before a retry — otherwise every retry fails on the same coupon, and the
      // total on screen no longer matches what would be charged.
      if (appliedPromo && String(error?.code || '').includes('failed-precondition')) {
        setAppliedPromo(null);
        setCouponError(friendlyServerMessage(error, 'That promo code could not be applied.'));
      }
      Alert.alert('Checkout Failed', friendlyError(error, 'Something went wrong during checkout. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderModelCard = (model: number) => {
    const m = logistics.bikeModels.find((b) => b.model === model);
    if (!m || !rentalType) return null;
    const avail = availabilityFor(model);
    // Three states, in priority order: nothing free at all (Sold Out, unselectable),
    // stock free but every unit already claimed by an earlier order (waitlist —
    // selectable, but the customer is told it needs confirming), or plain in stock.
    const soldOut = (avail?.available ?? 0) === 0;
    const waitlist = !soldOut && !!avail?.waitlist;
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
          {/* Waitlist banner — amber, and deliberately NOT the rotated stamp used for
              Sold Out: this card is still tappable and must not read as a dead end. */}
          {waitlist && (
            <View className="absolute inset-x-0 bottom-0 items-center">
              <View className="w-full bg-amber-500 px-4 py-2 border-t-2 border-white">
                <Text className="text-white font-black text-base uppercase tracking-widest text-center">
                  Add to Waitlist
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

          {/* NYC Admin Code § 20-610: a powered bicycle offered for rent or lease must be
              certified (UL 2849 / battery UL 2271) and the certifying laboratory's mark or
              name must appear on the online listing, alongside the DCWP/FDNY battery safety
              information. This is that listing, so the disclosure belongs on the card. */}
          <View className="mt-3 border-2 border-slate-200 bg-slate-50 rounded-xl px-3 py-2">
            <Text className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
              Safety certification
            </Text>
            {m.certification?.lab ? (
              <>
                <Text className="text-[11px] font-bold text-slate-600">
                  Certified by <Text className="font-black">{m.certification.lab}</Text>.
                </Text>
                <Text className="text-[11px] font-bold text-slate-600 mt-0.5">
                  Bike · {m.certification.deviceStandard || 'UL 2849'}
                  {m.certification.deviceCertificateNumber
                    ? ` · Certificate ${m.certification.deviceCertificateNumber}`
                    : ''}
                </Text>
                <Text className="text-[11px] font-bold text-slate-600 mt-0.5">
                  Battery · {m.certification.batteryStandard || 'UL 2271'}
                  {m.certification.batteryCertificateNumber
                    ? ` · Certificate ${m.certification.batteryCertificateNumber}`
                    : ''}
                </Text>
                <Text className="text-[11px] font-bold text-slate-500 mt-1">
                  Speed limited to 15 mph, the citywide limit for e-bikes in New York City.
                </Text>
                {!!m.certification.verifyUrl && (
                  <TouchableOpacity onPress={() => Linking.openURL(m.certification!.verifyUrl!)}>
                    <Text className="text-[11px] font-black text-brand-green-dark underline mt-1">
                      Verify this certificate →
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            ) : (
              <Text className="text-[11px] font-bold text-amber-700">
                Certification details for this model are being updated. Ask us before you order —
                every Foodyzz bike and battery is certified to UL 2849 / UL 2271.
              </Text>
            )}
            <TouchableOpacity
              onPress={() => Linking.openURL('https://www.nyc.gov/site/dca/about/micromobility-notices.page')}
            >
              <Text className="text-[11px] font-black text-brand-green-dark underline mt-1">
                NYC battery safety information →
              </Text>
            </TouchableOpacity>
          </View>

          {soldOut && (
            <View className="mt-3 border-2 border-red-200 bg-red-50 rounded-xl px-3 py-2">
              <Text className="text-[11px] font-bold text-red-500">
                {avail?.nextAvailableDate
                  ? `Expected back ${dayLabel(avail.nextAvailableDate)}`
                  : 'No bikes of this model are in stock right now.'}
              </Text>
            </View>
          )}

          {waitlist && (
            <View className="mt-3 border-2 border-amber-200 bg-amber-50 rounded-xl px-3 py-2">
              <Text className="text-[11px] font-bold text-amber-700">
                The last {avail?.available === 1 ? 'bike' : `${avail?.available} bikes`} of this model
                {avail?.available === 1 ? ' is' : ' are'} already spoken for. You can still place your
                order — an admin will confirm whether it can be fulfilled, and you are not charged
                until your bike is delivered.
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
      {/* Title bar + progress. Drawn here rather than as a native header for two
          reasons: iOS 26 wraps a custom headerRight in a shared-background capsule
          (a grey disc behind the close button, which react-native-screens 4.11 can't
          disable), and the white native header used to paint over the top of this
          white strip — invisibly, since both surfaces are the same white — which is
          what clipped the step label in half. No safe-area padding is needed: iOS
          presents this as a page sheet, below the status bar, and Android runs with
          edgeToEdgeEnabled false. The explicit lineHeight keeps the 10px uppercase
          glyphs off the top of their own line box. */}
      <View className="bg-white border-b-2 border-black pt-3">
        <View className="flex-row items-center px-5">
          <View className="flex-1" />
          <Text className="text-lg font-black text-black">Ride Now</Text>
          <View className="flex-1 items-end">
            <TouchableOpacity onPress={() => navigation.goBack()} className="p-2">
              <X size={22} color="black" />
            </TouchableOpacity>
          </View>
        </View>
        <View className="px-5 pt-3 pb-3">
          <Text
            style={{ lineHeight: 14 }}
            className="text-[10px] font-black text-slate-400 uppercase tracking-widest"
          >
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
      </View>

      {/* The notes field on step 6 sits at the very bottom of the scroll content, so
          without this the keyboard covered it. This view runs to the bottom of the
          screen, so the padding it adds is exactly the keyboard height — no vertical
          offset.
          Android needs the SAME padding behavior, not undefined. That used to rely on
          adjustResize (set in the manifest) resizing the window, but the app is now
          edge-to-edge (targetSdk 36) and enforced edge-to-edge stops that resize —
          which left Android with no avoidance at all and the keyboard back over the
          notes field. */}
      <KeyboardAvoidingView
        className="flex-1"
        behavior="padding"
      >
      <ScrollView
        ref={scrollRef}
        className="flex-1 px-5 pt-5"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
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
                Frame loading: can load 300 lbs (rider + cargo combined)
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
                Top speed: 19 mph{'\n'}
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
              {quote
                ? isInstalmentPlan
                  ? ' This is what you pay each month.'
                  : ` Your ${termLabel} rental is paid in one charge at delivery.`
                : ''}
            </Text>

            {/* The bike rental itself, in the slot the deposit used to hold. It is the
                one line every customer is looking for, and it opens the list with what
                they are actually paying rather than a refundable hold. Priced with the
                same rateFor() the quote and the backend use, so it cannot drift. */}
            {bikeModel && rentalType && quote && (
              <View className="flex-row items-center justify-between px-4 py-4 mb-3 rounded-2xl border-2 border-black bg-white shadow-brutalist">
                <View className="flex-1 pr-3">
                  <Text className="font-black text-slate-800 uppercase text-sm">Bike rental</Text>
                  <Text className="text-[11px] font-bold text-slate-400 mt-0.5">
                    Model {bikeModel} · ${rateFor(logistics, bikeModel, rentalType).toFixed(2)} per {unitLabel}
                    {isInstalmentPlan
                      ? ''
                      : ` × ${quote.durationValue} ${quote.durationValue === 1 ? unitLabel : quote.durationUnit}`}
                  </Text>
                </View>
                <View className="items-end">
                  {/* The amount actually taken: the whole term for plain rent, one
                      installment for rent-to-buy. Showing the weekly rate here was the
                      other half of the confusion — it sat next to "billed weekly". */}
                  <Text className="font-black text-slate-800">
                    $
                    {(
                      rateFor(logistics, bikeModel, rentalType) *
                      (isInstalmentPlan ? 1 : quote.durationValue)
                    ).toFixed(2)}
                  </Text>
                  <Text className="text-[10px] font-black uppercase mt-0.5 text-emerald-600">
                    {isInstalmentPlan ? 'Per month' : `${termLabel} total`}
                  </Text>
                </View>
              </View>
            )}

            {listedFees.map((fee) => {
              const locked = fee.required;
              // Kept for the label/copy branches below: the deposit no longer appears in
              // this list, but a `deposit` key reaching here must still never be opt-out.
              const isDeposit = fee.key === 'deposit';
              const uiLocked = locked || isDeposit;
              return (
                <TouchableOpacity
                  key={fee.key}
                  disabled={uiLocked}
                  onPress={() =>
                    setSelectedFees((prev) =>
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
                      {isDeposit
                        ? 'One time'
                        : isInstalmentPlan
                          ? 'Charged with each monthly payment'
                          : `Charged once for the ${termLabel} period`}
                      {isDeposit ? '' : locked ? ' · Required' : ' · Optional'}
                      {isDeposit ? ' · Refundable, not charged today' : ''}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="font-black text-slate-800">${fee.amount.toFixed(2)}</Text>
                    <Text className={`text-[10px] font-black uppercase mt-0.5 ${fee.accepted ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {fee.key === 'deposit' ? 'At delivery' : locked ? 'Required' : fee.accepted ? 'Added' : 'Tap to add'}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}

            {/* The all-in periodic price, stated once, above the charge explainer. Listing
                the parts without ever summing them is what turns a fee table into drip
                pricing — the customer must see the number they actually pay, on the same
                screen that promises no surprises. Tax and the card fee are named here and
                shown in full on the confirm step, once the provider (and its tax rate) is
                known. */}
            {quote && (
              <View className="flex-row items-center justify-between px-4 py-4 mb-3 rounded-2xl border-2 border-black bg-white shadow-brutalist">
                <View className="flex-1 pr-3">
                  <Text className="font-black text-slate-800 uppercase text-sm">
                    {isInstalmentPlan ? 'Total per month' : `Total for ${termLabel} rental`}
                  </Text>
                  <Text className="text-[11px] font-bold text-slate-400 mt-0.5">
                    Rental plus every required fee. Sales tax and the card processing fee are added on the
                    next step, before you pay.
                  </Text>
                </View>
                <Text className="text-lg font-black text-brand-green-dark">
                  $
                  {(isInstalmentPlan
                    ? (quote.perPeriodSubtotal ?? quote.total)
                    : quote.total
                  ).toFixed(2)}
                </Text>
              </View>
            )}

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
                  On delivery you will see <Text className="font-black">two separate transactions</Text>:{' '}
                  {isInstalmentPlan
                    ? 'your first monthly payment (rental plus fees) is charged'
                    : `your full ${termLabel} rental plus fees is charged in one payment`}
                  , and the ${quote?.depositAmount.toFixed(2) ?? '0.00'} security deposit
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

              {/* Recurring billing has to be disclosed before the card is taken, not after
                  the first charge — the amount, how often, for how long, and how to stop.
                  Plain rent is a single charge for the committed term, so this is
                  instalment-only. */}
              {isInstalmentPlan && quote && (
                <View className="flex-row items-start mt-2">
                  <Text className="text-[11px] font-black text-indigo-700 w-4">4.</Text>
                  <Text className="flex-1 text-[11px] font-bold text-indigo-700">
                    This plan then <Text className="font-black">renews automatically every month</Text> at $
                    {(quote.perPeriodSubtotal ?? quote.total).toFixed(2)} plus tax and card fee, for{' '}
                    {quote.durationValue} months, until the bike is paid off. We notify you before each
                    payment. You can pay the balance off early any time in My Rentals with no penalty —
                    amounts already owed stay payable.
                  </Text>
                </View>
              )}
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

            {/* Promo code — typed, pasted, or carried in from an offer card. A code is
                minted for ONE transaction type and is refused on the other two. */}
            <View className="border-2 border-black rounded-2xl bg-white p-4 mb-4 shadow-brutalist">
              <View className="flex-row items-center mb-2">
                <Ticket size={16} color="#507425" />
                <Text className="ml-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Promo code
                </Text>
              </View>

              {appliedPromo ? (
                <View className="flex-row items-center justify-between border-2 border-emerald-500 bg-emerald-50 rounded-xl px-3 py-3">
                  <View className="flex-1 pr-3">
                    <Text className="font-black text-emerald-700 font-mono tracking-[2px]">
                      {appliedPromo.offerCode}
                    </Text>
                    <Text className="text-[11px] font-bold text-emerald-600 mt-0.5">
                      {promoDiscountLabel(appliedPromo)}
                      {appliedPromo.title ? ` · ${appliedPromo.title}` : ''}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={clearCoupon}
                    className="w-9 h-9 rounded-lg border-2 border-emerald-500 items-center justify-center bg-white"
                    accessibilityLabel="Remove promo code"
                  >
                    <X size={16} color="#059669" />
                  </TouchableOpacity>
                </View>
              ) : (
                <View className="flex-row items-center">
                  <TextInput
                    value={couponInput}
                    onChangeText={(t) => {
                      setCouponInput(t.toUpperCase());
                      if (couponError) setCouponError(null);
                    }}
                    placeholder="Enter or paste a code"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    onSubmitEditing={() => applyCoupon(couponInput)}
                    returnKeyType="done"
                    className="flex-1 border-2 border-black rounded-xl bg-white px-3 py-3 font-black text-slate-700 font-mono tracking-[2px]"
                  />
                  <TouchableOpacity
                    disabled={!couponInput.trim() || couponChecking}
                    onPress={() => applyCoupon(couponInput)}
                    className={`ml-2 px-4 py-3 rounded-xl border-2 border-black items-center justify-center ${
                      couponInput.trim() && !couponChecking ? 'bg-brand-green' : 'bg-slate-200'
                    }`}
                  >
                    {couponChecking ? (
                      <ActivityIndicator color="#000000" />
                    ) : (
                      <Text className={`font-black uppercase text-xs ${couponInput.trim() ? 'text-black' : 'text-slate-400'}`}>
                        Apply
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}

              {couponError && (
                <Text className="text-[11px] font-bold text-red-500 mt-2">{couponError}</Text>
              )}
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
                      <SummaryRow
                        label="Fees"
                        value={`$${quote.recurringFees.toFixed(2)} ${isInstalmentPlan ? 'per month' : `per ${termLabel} period`}`}
                      />
                    )}
                  </>
                )}
                <View className="h-px bg-slate-200 my-2" />
                <SummaryRow
                  label={rentalType === 'rentToBuy' ? 'First month + fees' : 'Rental + fees'}
                  value={`$${quote.total.toFixed(2)}`}
                />
                {couponDiscount > 0 && appliedPromo && (
                  <View className="flex-row items-center justify-between py-1">
                    <Text className="text-xs font-bold text-emerald-600 uppercase">
                      Promo {appliedPromo.offerCode}
                    </Text>
                    <Text className="text-xs font-black text-emerald-600">
                      −${couponDiscount.toFixed(2)}
                    </Text>
                  </View>
                )}
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
                        ${totalBeforeCoupon.toFixed(2)}/month for {quote.durationValue} months, then the bike is yours.
                        The first month is charged at delivery; the rest are billed automatically each month to
                        your saved card.
                      </Text>
                      {couponDiscount > 0 && (
                        <Text className="text-[11px] font-black text-emerald-600 mt-1">
                          Your promo comes off the first month only — ${grandTotal.toFixed(2)} at delivery.
                        </Text>
                      )}
                      <View className="flex-row items-center justify-between mt-2 pt-2 border-t border-pink-200">
                        <Text className="text-[11px] font-black text-slate-500 uppercase">Total over {quote.durationValue} months</Text>
                        <Text className="text-sm font-black text-slate-800">
                          ${(totalBeforeCoupon * quote.durationValue - couponDiscount).toFixed(2)}
                        </Text>
                      </View>
                    </View>

                    {/* The statutory rent-to-own disclosures, in the customer's own terms. */}
                    {rtoTerms && (
                      <View className="bg-slate-50 border border-slate-200 rounded-xl p-3 mt-3">
                        <Text className="text-[11px] font-black text-slate-500 uppercase tracking-wide mb-2">
                          What it costs to own it
                        </Text>
                        <View className="flex-row items-center justify-between mb-1">
                          <Text className="text-[11px] font-bold text-slate-500">Cash price if you bought it today</Text>
                          <Text className="text-[11px] font-black text-slate-800">${rtoTerms.cashPrice.toFixed(2)}</Text>
                        </View>
                        <View className="flex-row items-center justify-between mb-1">
                          <Text className="text-[11px] font-bold text-slate-500">
                            {rtoTerms.months} payments of ${rtoTerms.perMonth.toFixed(2)}
                          </Text>
                          <Text className="text-[11px] font-black text-slate-800">
                            ${rtoTerms.totalOfPayments.toFixed(2)}
                          </Text>
                        </View>
                        <Text
                          className={`text-[11px] font-black mt-1 ${
                            rtoTerms.noFinanceCharge ? 'text-emerald-600' : 'text-slate-600'
                          }`}
                        >
                          {rtoTerms.noFinanceCharge
                            ? `0% interest — no finance charge. Paying monthly costs $${rtoTerms.difference.toFixed(2)} less than the cash price.`
                            : `Paying monthly costs $${rtoTerms.difference.toFixed(2)} more than the cash price. There is no interest rate — this is the difference between the two ways to buy.`}
                        </Text>
                        <Text className="text-[11px] font-bold text-slate-400 mt-2">
                          Ownership transfers to you only after the final payment or an early payoff. Sales tax and
                          the card processing fee are charged on each payment and are not included above.
                        </Text>
                      </View>
                    )}

                    {/* NY Personal Property Law § 504-a — the right to a reduced payment on a
                        25%+ involuntary income drop. § 501(7)(a) requires the agreement to
                        describe it, so it is disclosed where the plan is agreed to. */}
                    <View className="bg-amber-50 border border-amber-200 rounded-xl p-3 mt-3">
                      <Text className="text-[11px] font-black text-amber-800 uppercase tracking-wide mb-1">
                        If your income drops
                      </Text>
                      <Text className="text-[12px] font-bold text-amber-900">
                        Once you have paid at least half of the total above, you have a right to lower your monthly
                        payment if your income falls by 25% or more through involuntary job loss, reduced work,
                        illness, pregnancy, or disability. Send us evidence of the drop and we reduce each payment by
                        that percentage or 50%, whichever is smaller, for as long as it lasts. The total you pay to
                        own the bike does not change — the number of payments extends instead.
                      </Text>
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

            {/* Last point before the card is authorized — the customer should not reach
                the payment sheet without knowing this order still needs confirming. */}
            {isWaitlistOrder && (
              <View className="border-2 border-amber-400 bg-amber-50 rounded-2xl px-4 py-3 mb-5">
                <Text className="text-xs font-black text-amber-800 uppercase tracking-wide mb-1">
                  Waitlist order
                </Text>
                <Text className="text-[11px] font-bold text-amber-700">
                  Every bike of this model is already claimed by an earlier order. Admin will confirm
                  if this order can be fulfilled. Your card is only authorized now — you are not
                  charged unless the bike is delivered.
                </Text>
              </View>
            )}

            {/* A disclosure nobody records is worth very little the day it matters. The
                rider ticks these, and what they ticked is written onto the order with the
                version of the Terms they saw — so the record survives a later edit to this
                screen's copy or to the Terms themselves. */}
            <View className="border-2 border-black bg-white rounded-2xl p-4 mb-6 shadow-brutalist">
              <View className="flex-row items-center mb-3">
                <ShieldCheck size={16} color="#507425" />
                <Text className="ml-2 text-[11px] font-black text-slate-700 uppercase tracking-wide">
                  Before you confirm
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => setAckSafety((v) => !v)}
                className="flex-row items-start mb-3"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: ackSafety }}
              >
                <View
                  className={`w-6 h-6 rounded-md border-2 border-black items-center justify-center mr-3 ${
                    ackSafety ? 'bg-brand-green' : 'bg-white'
                  }`}
                >
                  {ackSafety && <Check size={14} color="#0A0A0A" strokeWidth={4} />}
                </View>
                <Text className="flex-1 text-[12px] font-bold text-slate-600">
                  I will <Text className="font-black">wear a helmet on every ride</Text>, keep to New York
                  City's <Text className="font-black">15 mph</Text> e-bike limit and not tamper with the
                  limiter, follow all traffic laws, and charge the battery only with the charger Foodyzz
                  supplies — indoors, never unattended overnight.
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setAckTerms((v) => !v)}
                className="flex-row items-start"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: ackTerms }}
              >
                <View
                  className={`w-6 h-6 rounded-md border-2 border-black items-center justify-center mr-3 ${
                    ackTerms ? 'bg-brand-green' : 'bg-white'
                  }`}
                >
                  {ackTerms && <Check size={14} color="#0A0A0A" strokeWidth={4} />}
                </View>
                <Text className="flex-1 text-[12px] font-bold text-slate-600">
                  I am renting this bike <Text className="font-black">mainly for delivery or courier
                  work</Text>, not mainly for personal, family, or household use, and I accept the Terms
                  &amp; Conditions and the Protection Plan.
                </Text>
              </TouchableOpacity>

              <View className="flex-row mt-3 ml-9">
                <TouchableOpacity onPress={() => Linking.openURL('https://foodyzz.com/terms')}>
                  <Text className="text-[11px] font-black text-brand-green-dark underline">Terms</Text>
                </TouchableOpacity>
                <Text className="text-[11px] font-black text-slate-300 mx-2">·</Text>
                <TouchableOpacity onPress={() => Linking.openURL('https://foodyzz.com/protection')}>
                  <Text className="text-[11px] font-black text-brand-green-dark underline">
                    Protection Plan
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <Text className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Notes (optional)</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Gate code, building, anything the rider should know"
              multiline
              // The avoiding view shrinks the scroll area as the keyboard comes up;
              // scrolling to the end then parks this field directly above it.
              onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150)}
              className="border-2 border-black rounded-2xl bg-white px-4 py-3 mb-8 font-bold text-slate-700 min-h-[80px]"
            />
          </View>
        )}
      </ScrollView>

      {/* Footer — inside the avoiding view so the pay CTA rides above the keyboard
          instead of being buried under it while the notes field has focus. */}
      <View className="px-5 pt-4 bg-white border-t-2 border-black flex-row" style={{ paddingBottom: bottom + 16 }}>
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
      </KeyboardAvoidingView>
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
