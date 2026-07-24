import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MapPin, CheckCircle, X } from 'lucide-react-native';
import { fetchPlaceSuggestions, fetchPlaceDetails, PlacePrediction } from '../services/geo';

interface Props {
  value: string;
  onSelect: (formattedAddress: string) => void;
  apiKey?: string;
  placeholder?: string;
  placeholderTextColor?: string;
  inputClassName: string;          // styling owned by the caller's form
}

const DEBOUNCE_MS = 400;

/**
 * Google-assisted address field, mirroring the scrubshq onboarding pattern:
 * debounced autocomplete suggestions, a confirmed/"Change" state once a place is
 * picked. Production-safe — the debounce timer is cleared on unmount and a
 * monotonic request id discards stale fetch responses so we never set state on
 * an unmounted component or with out-of-order results.
 */
export default function AddressAutocomplete({
  value,
  onSelect,
  apiKey,
  placeholder = 'Start typing your address…',
  placeholderTextColor = '#94a3b8',
  inputClassName,
}: Props) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const runSearch = useCallback((text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!apiKey || text.trim().length < 3) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const reqId = ++reqIdRef.current;
    debounceRef.current = setTimeout(async () => {
      const results = await fetchPlaceSuggestions(text, apiKey);
      // Discard if a newer keystroke superseded this request or we unmounted.
      if (!mountedRef.current || reqId !== reqIdRef.current) return;
      setSuggestions(results);
      setLoading(false);
    }, DEBOUNCE_MS);
  }, [apiKey]);

  const handleChange = (text: string) => {
    setQuery(text);
    runSearch(text);
  };

  const handlePick = async (pred: PlacePrediction) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    reqIdRef.current++; // invalidate any in-flight suggestion fetch
    setSuggestions([]);
    setQuery('');
    setLoading(true);
    const formatted = (apiKey ? await fetchPlaceDetails(pred.place_id, apiKey) : '') || pred.description;
    if (!mountedRef.current) return;
    setLoading(false);
    onSelect(formatted);
  };

  // Confirmed state: a value is set and the user isn't actively editing.
  if (value && !query) {
    return (
      <View className="border-2 border-emerald-500 rounded-2xl overflow-hidden">
        <View className="bg-white p-3">
          <Text className="text-sm font-bold text-slate-700 leading-relaxed">{value}</Text>
        </View>
        <View className="bg-emerald-50 px-3 py-2 flex-row items-center gap-2 border-t border-emerald-200">
          <CheckCircle size={12} color="#10b981" />
          <Text className="text-emerald-600 text-[9px] font-black uppercase flex-1">Address confirmed</Text>
          <TouchableOpacity
            onPress={() => { setQuery(''); setSuggestions([]); onSelect(''); }}
            className="flex-row items-center gap-1"
          >
            <X size={11} color="#507425" />
            <Text className="text-brand-green text-[9px] font-black uppercase">Change</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View>
      <View className="flex-row items-center">
        <TextInput
          value={query}
          onChangeText={handleChange}
          placeholder={placeholder}
          placeholderTextColor={placeholderTextColor}
          autoCorrect={false}
          className={`flex-1 ${inputClassName}`}
        />
        {loading && <ActivityIndicator size="small" color="#94a3b8" style={{ marginLeft: -32 }} />}
      </View>
      {suggestions.length > 0 && (
        <View className="mt-1 bg-white border-2 border-black rounded-2xl overflow-hidden">
          {suggestions.map((pred, i) => (
            <TouchableOpacity
              key={pred.place_id}
              onPress={() => handlePick(pred)}
              className={`flex-row items-start gap-2 px-4 py-3 ${i > 0 ? 'border-t border-slate-100' : ''}`}
            >
              <MapPin size={14} color="#507425" style={{ marginTop: 1 }} />
              <Text className="text-[13px] font-bold text-slate-700 flex-1">{pred.description}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}
