import React, { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { ArrowLeft, Send, ShieldCheck } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { auth, db, getActiveProviderId } from '../services/firebase';
import { COLORS } from '../theme';
import { SupportMessage, AppRole } from '../types';

export default function SupportScreen() {
  const navigation = useNavigation();
  // This is a headerShown:false stack route, so the screen owns both insets.
  const insets = useSafeAreaInsets();
  const user = auth().currentUser;
  const [supportInputText, setSupportInputText] = useState('');
  const [supportMessages, setSupportMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [providerProfile, setProviderProfile] = useState<any>(null);
  const [showNewIndicator, setShowNewIndicator] = useState(false);
  const lastCount = useRef(0);
  const scrollViewRef = useRef<ScrollView>(null);
  // Holds the "new response" indicator timer so we can clear it on unmount and
  // never setState (setShowNewIndicator) after the component is gone.
  const newIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user?.phoneNumber) return;

    // Fetch the active store profile (`${phone}_${zip}`) for the message payload.
    let unsubProfile: (() => void) | undefined;
    (async () => {
      const providerId = await getActiveProviderId();
      if (!providerId) return;
      unsubProfile = db.collection('providers').doc(providerId)
        .onSnapshot(
          (snap) => { if (snap?.exists) setProviderProfile(snap.data()); },
          (error) => { console.warn('Provider profile fetch error:', error.message); }
        );
    })();

    const unsubscribe = db.collection('supportMessages')
      .where('userPhone', '==', user.phoneNumber)
      .onSnapshot((snapshot) => {
        const messages: SupportMessage[] = snapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() } as SupportMessage))
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        // Initialize the count on first data load
        if (lastCount.current === 0) {
          lastCount.current = messages.length;
        }
        setSupportMessages(messages);
        setLoading(false);
      }, (error) => {
      console.error("Error fetching support messages:", error);
      setLoading(false);
    });

    return () => {
      unsubProfile?.();
      unsubscribe();
    };
    // Depend on the primitive phone number rather than the whole `user` object,
    // which is a fresh reference each render (matches useActiveProvider). The
    // effect only ever uses user.phoneNumber.
  }, [user?.phoneNumber]);

  useEffect(() => {
    if (scrollViewRef.current) {
      scrollViewRef.current.scrollToEnd({ animated: true });
    }

    // Show indicator if a new message arrives from admin
    if (supportMessages.length > lastCount.current) {
      const lastMsg = supportMessages[supportMessages.length - 1];
      if (lastMsg.senderPhone !== user?.phoneNumber) {
        setShowNewIndicator(true);
        // Track the timer so an unmount before it fires can cancel it.
        if (newIndicatorTimerRef.current) clearTimeout(newIndicatorTimerRef.current);
        newIndicatorTimerRef.current = setTimeout(() => setShowNewIndicator(false), 5000);
      }
      lastCount.current = supportMessages.length;
    }
  }, [supportMessages]);

  // Clear the "new response" indicator timer on unmount.
  useEffect(() => () => {
    if (newIndicatorTimerRef.current) clearTimeout(newIndicatorTimerRef.current);
  }, []);

  const handleSendSupport = async () => {
    if (!supportInputText.trim() || !user?.phoneNumber) return;

    const newMsg: SupportMessage = {
      userPhone: user.phoneNumber,
      userName: providerProfile?.businessName || 'Provider Hub',
      userRole: AppRole.PROVIDER,
      senderPhone: user.phoneNumber,
      senderName: providerProfile?.businessName || 'Provider Hub',
      text: supportInputText,
      timestamp: new Date().toISOString(),
      isReadByAdmin: false,
    };

    try {
      await db.collection('supportMessages').add(newMsg);
      setSupportInputText('');
    } catch (error) {
      Alert.alert("Sync Error", "Could not reach the support node.");
    }
  };

  if (loading) {
    return (
      <View className="flex-1 justify-center items-center bg-white">
        <ActivityIndicator color={COLORS.brand.green} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-white"
    >
      {/* Secure Support Header */}
      <View className="bg-slate-900 px-4 pb-4 border-b-4 border-black flex-row items-center justify-between shadow-sm" style={{ paddingTop: insets.top + 16 }}>
        <View className="flex-row items-center gap-3">
          <TouchableOpacity 
            onPress={() => navigation.goBack()} 
            className="p-2 bg-slate-800 rounded-xl border-2 border-black"
          >
            <ArrowLeft size={18} color="white" />
          </TouchableOpacity>
          <View>
            <Text className="text-[10px] font-mono font-black text-brand-green uppercase tracking-widest mb-0.5 leading-none">
              Command Support
            </Text>
            <Text className="text-sm font-black text-white uppercase tracking-tight leading-none">
              Admin Terminal
            </Text>
          </View>
        </View>
        <View className="bg-brand-green/10 px-2.5 py-1 rounded-lg border-2 border-brand-green">
           <ShieldCheck size={12} color="#86B54F" />
        </View>
      </View>

      {/* New Message Indicator */}
      {showNewIndicator && (
        <View className="absolute top-24 left-0 right-0 items-center z-50">
          <View className="bg-brand-green border-2 border-black px-4 py-2 rounded-full flex-row items-center gap-2 shadow-sm">
            <ShieldCheck size={12} color="black" />
            <Text className="text-black font-black text-[10px] uppercase">New Response from HQ</Text>
          </View>
        </View>
      )}

      <ScrollView ref={scrollViewRef} className="flex-1 p-4" showsVerticalScrollIndicator={false}>
        {supportMessages.length === 0 ? (
          <View className="mt-10 p-10 bg-slate-50 border-2 border-dashed border-slate-200 rounded-[32px] items-center">
            <Text className="text-slate-400 font-bold text-center text-xs uppercase leading-relaxed">
              Direct line to HQ established.{"\n"}Send a message for assistance.
            </Text>
          </View>
        ) : (
          supportMessages.map((msg, i) => {
            const isFromMe = msg.senderPhone === user?.phoneNumber;
            return (
              <View key={msg.id || i} className={`flex-row ${isFromMe ? 'justify-end' : 'justify-start'} mb-4`}>
                <View className={`max-w-[85%] p-3 rounded-2xl border-2 border-black shadow-sm ${
                  isFromMe ? 'bg-brand-green rounded-tr-none' : 'bg-slate-100 rounded-tl-none'
                }`}>
                  <Text className={`text-[11px] font-bold leading-relaxed ${isFromMe ? 'text-black' : 'text-slate-800'}`}>
                    {msg.text}
                  </Text>
                  <Text className={`text-[7.5px] font-mono font-black uppercase mt-2 text-right ${isFromMe ? 'text-brand-green' : 'text-slate-400'}`}>
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <View className="p-4 bg-slate-900 border-t-4 border-black flex-row items-center gap-3" style={{ paddingBottom: insets.bottom + 16 }}>
        <TextInput
          value={supportInputText}
          onChangeText={setSupportInputText}
          placeholder="Describe your issue..."
          placeholderTextColor="#94a3b8"
          className="flex-1 bg-white border-2 border-slate-200 rounded-2xl px-4 py-3 text-xs font-bold text-slate-900"
        />
        <TouchableOpacity 
          onPress={handleSendSupport}
          disabled={!supportInputText.trim()}
          className={`w-12 h-12 rounded-2xl items-center justify-center border-2 border-black shadow-brutalist ${
            supportInputText.trim() ? 'bg-brand-green' : 'bg-slate-800 opacity-50'
          }`}
        >
          <Send size={18} color="black" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}