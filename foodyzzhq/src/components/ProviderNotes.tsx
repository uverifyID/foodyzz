import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Keyboard, TouchableWithoutFeedback } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FileText, Plus, X, Check } from 'lucide-react-native';
import firebase from '@react-native-firebase/app';

// Cross-card cache of fetched notes (keyed by orderId). FlatList unmounts/remounts
// cards as they scroll in and out, so without this every scroll would re-fire the
// getOrderNote callable. Populated on mount + kept fresh on save.
const noteCache = new Map<string, string>();

// Provider-private note on an order. Stored server-side in `orderNotes/{orderId}`
// (no client read/write — see the getOrderNote/setOrderNote callables), so the
// customer never sees it. The note is fetched on mount so it's visible right on the
// card (no need to open the editor) and the editor opens instantly with the text
// already loaded. Persists for the life of the transaction.
export default function ProviderNotes({ orderId }: { orderId: string }) {
  // A Modal covers the whole window including the nav bar, so sheets inside one
  // carry their own bottom inset regardless of what the screen behind them does.
  const { bottom } = useSafeAreaInsets();
  const cached = noteCache.get(orderId);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(cached ?? '');
  const [saved, setSaved] = useState(cached ?? '');     // last persisted value (drives the card preview)
  const [loaded, setLoaded] = useState(cached !== undefined); // whether we've fetched this order's note yet
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // FlatList recycles cards on scroll, so a card can unmount while a callable is
  // still in flight — don't setState on an unmounted component.
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const fns = firebase.app().functions('us-central1');

  const fetchNote = async () => {
    setLoading(true);
    try {
      const res: any = await fns.httpsCallable('getOrderNote')({ orderId });
      if (!mounted.current) return;
      const notes = res?.data?.notes ?? '';
      noteCache.set(orderId, notes);
      setText(notes);
      setSaved(notes);
      setLoaded(true);
    } catch {
      // Leave it unloaded; a transient fetch failure shouldn't block adding a note.
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  // Preload on mount so an existing note renders on the card straight away and the
  // editor never has to show a spinner. Skips the network when already cached.
  useEffect(() => {
    if (loaded) return;
    fetchNote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const openEditor = async () => {
    setOpen(true);
    if (loaded) { setText(saved); return; }
    await fetchNote();
  };

  const save = async () => {
    setSaving(true);
    try {
      await fns.httpsCallable('setOrderNote')({ orderId, notes: text });
      if (!mounted.current) return;
      noteCache.set(orderId, text);
      setSaved(text);
      setLoaded(true);
      setOpen(false);
    } catch {
      // Keep the editor open so the provider can retry without losing their text.
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const hasNote = !!saved.trim();

  return (
    <View className="flex-row items-start gap-2.5">
      <FileText size={14} color="#507425" />
      <View className="flex-1">
        <Text className="text-slate-500 text-[8px] font-black uppercase mb-0.5">Notes</Text>
        <TouchableOpacity onPress={openEditor} className="flex-row items-center gap-2" activeOpacity={0.7}>
          {hasNote ? (
            // Shown in full (no clamp) and in blue — matching the school/campus color —
            // so the provider never has to open the editor just to read the note.
            <Text className="text-indigo-700 text-[10px] font-bold flex-1">{saved}</Text>
          ) : (
            <Text className="text-slate-400 text-[10px] font-bold flex-1">Add a private note…</Text>
          )}
          <View className="w-5 h-5 rounded-full bg-slate-100 border border-slate-200 items-center justify-center">
            <Plus size={12} color="#475569" />
          </View>
        </TouchableOpacity>
      </View>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View className="flex-1 bg-black/80 justify-end">
            <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); setOpen(false); }}>
              <View style={{ flex: 1 }} />
            </TouchableWithoutFeedback>
            <View className="bg-white rounded-t-[44px] border-t-4 border-black p-6" style={{ paddingBottom: bottom + 24 }}>
              <View className="flex-row justify-between items-center mb-2">
                <View>
                  <Text className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest mb-1">Private · provider only</Text>
                  <Text className="text-xl font-black text-black uppercase tracking-tighter">Order Notes</Text>
                </View>
                <TouchableOpacity onPress={() => setOpen(false)} className="p-2 bg-slate-100 border border-slate-200 rounded-full">
                  <X size={20} color="black" />
                </TouchableOpacity>
              </View>
              <Text className="text-slate-500 text-[11px] font-bold mb-3">Only you can see this. It stays on the order through the whole job.</Text>

              {loading ? (
                <View className="h-32 items-center justify-center"><ActivityIndicator color="#507425" /></View>
              ) : (
                <TextInput
                  value={text}
                  onChangeText={setText}
                  multiline
                  textAlignVertical="top"
                  placeholder="e.g. Stain on collar — pre-treated. Customer prefers fragrance-free."
                  placeholderTextColor="#94a3b8"
                  maxLength={5000}
                  className="bg-slate-50 border-2 border-black rounded-2xl p-4 text-black font-bold min-h-[140px]"
                />
              )}

              <TouchableOpacity
                onPress={save}
                disabled={saving || loading}
                activeOpacity={saving || loading ? 1 : 0.8}
                className={`mt-4 py-4 rounded-2xl items-center border-2 border-black flex-row justify-center gap-2 ${saving || loading ? 'bg-slate-200' : 'bg-[#86B54F]'}`}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="black" />
                ) : (
                  // View (not Fragment): RN 0.79/React 19 TouchableOpacity applies
                  // style to its single child; a Fragment child triggers a warning.
                  <View className="flex-row items-center gap-2">
                    <Check size={16} color="black" />
                    <Text className="text-black font-black uppercase text-sm tracking-widest">Save Note</Text>
                  </View>
                )}
              </TouchableOpacity>
              <View style={{ paddingBottom: 16 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
