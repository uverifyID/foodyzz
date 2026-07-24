import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  Pressable,
  useWindowDimensions,
  StatusBar,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight } from 'lucide-react-native';

// Provider walkthrough slides shown once on a fresh install, before sign-in.
const SLIDES = [
  require('../../assets/images/newinstall/p1.png'),
  require('../../assets/images/newinstall/p2.png'),
  require('../../assets/images/newinstall/p3.png'),
  require('../../assets/images/newinstall/p4.png'),
  require('../../assets/images/newinstall/p5.png'),
  require('../../assets/images/newinstall/p6.png'),
];

const BRAND = '#86B54F'; // provider orange
const BG = '#EAF4FB'; // matches the slides' sky tint so side margins blend in

type Props = { onDone: () => void };

export default function OnboardingSlider({ onDone }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList>(null);
  const [index, setIndex] = useState(0);

  const isLast = index === SLIDES.length - 1;

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== index) setIndex(next);
  };

  const goNext = () => {
    if (isLast) {
      onDone();
      return;
    }
    // Advance state immediately — onMomentumScrollEnd doesn't reliably fire for
    // programmatic scrolls on Android, so relying on it alone leaves `index`
    // stale and makes the next tap a no-op (button feels unresponsive).
    const next = index + 1;
    setIndex(next);
    listRef.current?.scrollToIndex({ index: next, animated: true });
  };

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <StatusBar barStyle="dark-content" />

      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(_, i) => `slide-${i}`}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item }) => (
          <View style={{ width, height, backgroundColor: BG }}>
            <Image source={item} resizeMode="contain" style={{ flex: 1, width, height }} />
          </View>
        )}
      />

      {/* Skip — top-right, hidden on the last slide */}
      {!isLast && (
        <Pressable
          onPress={onDone}
          hitSlop={12}
          style={{
            position: 'absolute',
            top: insets.top + 8,
            right: 16,
            paddingHorizontal: 14,
            paddingVertical: 6,
            borderRadius: 999,
            backgroundColor: 'rgba(255,255,255,0.75)',
          }}
        >
          <Text style={{ color: '#334155', fontFamily: 'Inter_700Bold', fontSize: 14 }}>Skip</Text>
        </Pressable>
      )}

      {/* Bottom controls over a subtle scrim */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingBottom: insets.bottom + 16,
          paddingTop: 16,
          paddingHorizontal: 20,
          backgroundColor: 'rgba(234,244,251,0.85)',
          alignItems: 'center',
        }}
      >
        {/* Dots */}
        <View style={{ flexDirection: 'row', marginBottom: 16 }}>
          {SLIDES.map((_, i) => (
            <View
              key={`dot-${i}`}
              style={{
                width: i === index ? 22 : 8,
                height: 8,
                borderRadius: 4,
                marginHorizontal: 4,
                backgroundColor: i === index ? BRAND : '#CBD5E1',
              }}
            />
          ))}
        </View>

        {/* Primary button */}
        <Pressable
          onPress={goNext}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            paddingVertical: 15,
            borderRadius: 14,
            backgroundColor: BRAND,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 16 }}>
            {isLast ? 'Get Started' : 'Next'}
          </Text>
          {!isLast && <ChevronRight size={20} color="#FFFFFF" style={{ marginLeft: 4 }} />}
        </Pressable>
      </View>
    </View>
  );
}
