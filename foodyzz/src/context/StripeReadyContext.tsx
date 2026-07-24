import { createContext, useContext } from 'react';

// True only once the REAL Stripe publishable key (from apiConfig/global) has been
// fetched and handed to StripeProvider. The provider must mount immediately with a
// "pk_test_placeholder" fallback so the app tree can render, which means there is a
// brief window where useStripe() would talk to Stripe against that placeholder.
// Payment-initiating UI consumes this flag to stay disabled until the real key lands,
// guaranteeing no payment sheet / payment-method call ever runs against the placeholder.
export const StripeReadyContext = createContext(false);

export const useStripeReady = () => useContext(StripeReadyContext);
