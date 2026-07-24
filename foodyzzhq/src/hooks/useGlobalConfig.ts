import { useEffect, useState } from 'react';
import { subscribeToGlobalConfig } from '../services/firebase';

/**
 * Live `apiConfig/global` document (commission rate, delivery fees, Stripe key…).
 * Thin wrapper over subscribeToGlobalConfig that was duplicated across screens.
 */
export function useGlobalConfig() {
  const [config, setConfig] = useState<any>(null);

  useEffect(() => {
    const unsub = subscribeToGlobalConfig(setConfig);
    return () => unsub();
  }, []);

  return config;
}
