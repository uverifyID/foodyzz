import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SOUND_ENABLED_KEY = '@notification_sound_enabled';
const SOUND_SELECTION_KEY = '@notification_sound_selection';

// Static require map — Metro resolves these at build time, so no dynamic require().
// Foreground playback uses the mp3s (expo-av plays mp3 fine on both platforms);
// the .caf set is only for native iOS notification sounds (see app.json plugin).
const SOUND_MAP: Record<string, any> = {
  bell:         require('../../assets/sounds/android/bell.mp3'),
  confirmation: require('../../assets/sounds/android/confirmation.mp3'),
  doorbell:     require('../../assets/sounds/android/doorbell.mp3'),
  happybell:    require('../../assets/sounds/android/happybell.mp3'),
  officering:   require('../../assets/sounds/android/officering.mp3'),
  oldphone:     require('../../assets/sounds/android/oldphone.mp3'),
  quicktone:    require('../../assets/sounds/android/quicktone.mp3'),
  vintage:      require('../../assets/sounds/android/vintage.mp3'),
};

// Single source of truth for sound keys — used to register one Android
// notification channel per sound (`order_<key>`) so background pushes can play
// the recipient's chosen sound. Must match the bundled .caf/.mp3 filenames and
// the SOUND_KEYS list in functions/src/index.ts.
export const SOUND_NAMES = Object.keys(SOUND_MAP);

let currentSound: Audio.Sound | null = null;

export async function stopCurrentSound(): Promise<void> {
  if (!currentSound) return;
  try {
    await currentSound.stopAsync();
    await currentSound.unloadAsync();
  } catch (_) {
    // Already unloaded — safe to ignore
  } finally {
    currentSound = null;
  }
}

async function _playSound(name: string): Promise<void> {
  await stopCurrentSound();

  await Audio.setAudioModeAsync({
    playsInSilentModeIOS: true, // Play even when device is in silent/vibrate mode
    allowsRecordingIOS: false,
    staysActiveInBackground: false,
    // Primary (non-ducked) audio session so the dispatch alert plays at full output.
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    shouldDuckAndroid: false,
  });

  const source = SOUND_MAP[name] ?? SOUND_MAP['bell'];
  const { sound } = await Audio.Sound.createAsync(source, { shouldPlay: true, volume: 1.0 });
  currentSound = sound;

  sound.setOnPlaybackStatusUpdate((status) => {
    if (status.isLoaded && status.didJustFinish) {
      sound.unloadAsync().catch(() => {});
      if (currentSound === sound) currentSound = null;
    }
  });
}

/**
 * Plays the provider's chosen notification sound.
 * Reads @notification_sound_enabled and @notification_sound_selection from AsyncStorage.
 * An optional override bypasses the AsyncStorage selection lookup.
 */
export async function playNotificationSound(override?: string): Promise<void> {
  try {
    const enabled = await AsyncStorage.getItem(SOUND_ENABLED_KEY);
    if (enabled === 'false') return;

    const name = override ?? (await AsyncStorage.getItem(SOUND_SELECTION_KEY)) ?? 'bell';
    await _playSound(name);
  } catch (e) {
    console.warn('[soundPlayer] playNotificationSound error:', e);
  }
}

/**
 * Always plays the given sound, ignoring the enabled preference.
 * Used by the settings UI preview buttons.
 */
export async function previewSound(name: string): Promise<void> {
  try {
    await _playSound(name);
  } catch (e) {
    console.warn('[soundPlayer] previewSound error:', e);
  }
}
