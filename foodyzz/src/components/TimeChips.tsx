import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

// Friendly single-time selector: a row of common times up front, plus an "Other"
// chip that expands the full list inline. No dropdown and no native picker — the
// customer taps the time they want in one or two taps. Past/invalid times are
// shown disabled via isDisabled so they can't be selected.
export default function TimeChips({
  value,
  onChange,
  quick,
  all,
  isDisabled,
}: {
  value: string;
  onChange: (t: string) => void;
  quick: string[];
  all: string[];
  isDisabled?: (t: string) => boolean;
}) {
  const valueInQuick = quick.includes(value);
  // Start collapsed — the full time list only appears when the user taps "Other".
  // A custom (non-quick) selection stays visible via the "Other · <time>" chip
  // label, so there's no need to dump the entire list under the quick row by
  // default (that made the Need-By section look cluttered with a wall of times).
  const [expanded, setExpanded] = useState(false);

  const Chip = ({ t }: { t: string }) => {
    const disabled = isDisabled?.(t) ?? false;
    const selected = value === t;
    return (
      <TouchableOpacity
        disabled={disabled}
        onPress={() => onChange(t)}
        className={`px-3 py-2 rounded-xl border-2 ${
          selected ? 'bg-indigo-600 border-indigo-600' : disabled ? 'bg-slate-100 border-slate-100' : 'bg-white border-slate-200'
        }`}
      >
        <Text className={`text-[10px] font-black ${selected ? 'text-white' : disabled ? 'text-slate-300' : 'text-slate-600'}`}>
          {t}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View>
      <View className="flex-row flex-wrap gap-2">
        {quick.map(t => <Chip key={t} t={t} />)}
        <TouchableOpacity
          onPress={() => setExpanded(e => !e)}
          className={`px-3 py-2 rounded-xl border-2 ${!valueInQuick ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-200'}`}
        >
          <Text className={`text-[10px] font-black ${!valueInQuick ? 'text-white' : 'text-slate-600'}`}>
            {valueInQuick ? 'Other' : `Other · ${value}`}
          </Text>
        </TouchableOpacity>
      </View>
      {expanded && (
        <View className="flex-row flex-wrap gap-2 mt-2 pt-2 border-t border-slate-200">
          {all.map(t => <Chip key={t} t={t} />)}
        </View>
      )}
    </View>
  );
}
