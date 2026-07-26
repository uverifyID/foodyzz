import { useEffect, useState } from 'react';
import { subscribeToLogisticsConfig, DEFAULT_LOGISTICS } from '../services/logistics';
import type { LogisticsConfig } from '../types';

/**
 * Live `apiConfig/logistics` document (bike rates, fees, delivery window, the
 * missed-pickup admin fee…). Starts on DEFAULT_LOGISTICS so a screen can quote a
 * number before the first snapshot lands.
 */
export function useLogisticsConfig(): LogisticsConfig {
  const [config, setConfig] = useState<LogisticsConfig>(DEFAULT_LOGISTICS);
  useEffect(() => subscribeToLogisticsConfig(setConfig), []);
  return config;
}
