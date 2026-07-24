import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { ArrowLeft, Send, MessageSquare, User as UserIcon, Building2 } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../services/firebase';
import { COLORS } from '../theme';
import { SupportMessage } from '../types';

// Is this an incoming (customer/provider) message that HQ hasn't read yet?
const isUnreadForAdmin = (m: SupportMessage) =>
  !m.isReadByAdmin && m.senderPhone !== 'admin' && m.senderPhone !== 'system';

// FoodyzzHQ one-to-many support manager. Reads the whole `supportMessages`
// collection and buckets it into per-`userPhone` threads (customers + providers),
// exactly like the webapp admin ChatManagerTab (src/components/admin/ChatManagerTab.tsx).
// Replies are written back as `senderRole:'admin'` so the existing
// onAdminReplyToSupport function pushes them to the user's device and they land
// in the customer's FoodyzzHQ Chat tab. Mobile shows one thread at a time.
export default function HqChatScreen() {
  const insets = useSafeAreaInsets();
  const [allMessages, setAllMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [openPhone, setOpenPhone] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  // Ref points at the open-thread message list (now a FlatList — see below).
  const scrollViewRef = useRef<FlatList<SupportMessage>>(null);

  useEffect(() => {
    // Bound this platform-wide listener: order DESCENDING + limit to the most
    // recent 500 messages (was unbounded asc, which streamed every support
    // message across the whole platform). Reverse back to ascending so the
    // downstream bucketing/rendering logic below is unchanged.
    const unsub = db.collection('supportMessages')
      .orderBy('timestamp', 'desc')
      .limit(500)
      .onSnapshot((snapshot) => {
        if (!snapshot) return;
        const msgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as SupportMessage)).reverse();
        setAllMessages(msgs);
        setLoading(false);
      }, (error) => {
        console.error('Error fetching support messages:', error);
        setLoading(false);
      });
    return unsub;
  }, []);

  // Bucket into threads keyed by userPhone, newest-active first.
  const threads = useMemo(() => {
    const map: Record<string, SupportMessage[]> = {};
    for (const m of allMessages) {
      if (!m.userPhone) continue;
      (map[m.userPhone] ||= []).push(m);
    }
    return Object.entries(map).sort((a, b) => {
      const aLast = a[1][a[1].length - 1]?.timestamp || '';
      const bLast = b[1][b[1].length - 1]?.timestamp || '';
      return bLast.localeCompare(aLast);
    });
  }, [allMessages]);

  const openMessages = openPhone ? (threads.find(([p]) => p === openPhone)?.[1] || []) : [];

  useEffect(() => {
    if (openPhone && scrollViewRef.current) {
      scrollViewRef.current.scrollToEnd({ animated: true });
    }
  }, [openMessages.length, openPhone]);

  // Mark all incoming messages in a thread as read by admin.
  const markThreadRead = async (phone: string) => {
    const unread = (threads.find(([p]) => p === phone)?.[1] || []).filter(isUnreadForAdmin);
    if (unread.length === 0) return;
    try {
      const batch = db.batch();
      unread.forEach((m) => {
        if (m.id) batch.update(db.collection('supportMessages').doc(m.id), { isReadByAdmin: true });
      });
      await batch.commit();
    } catch (e) {
      // Non-fatal: the badge just lingers until next open.
      console.warn('markThreadRead failed', e);
    }
  };

  const openThread = (phone: string) => {
    setOpenPhone(phone);
    setReplyText('');
    markThreadRead(phone);
  };

  const handleSend = async () => {
    const text = replyText.trim();
    if (!text || !openPhone) return;
    const thread = threads.find(([p]) => p === openPhone)?.[1] || [];
    const first = thread[0];
    const newMsg: SupportMessage = {
      userPhone: openPhone,
      userName: first?.userName || 'Customer',
      userRole: first?.userRole || 'customer',
      // senderPhone:'admin' is what onAdminReplyToSupport keys on to push the
      // reply to the user's device — no senderRole needed on the payload.
      senderPhone: 'admin',
      senderName: 'FoodyzzHQ',
      text,
      timestamp: new Date().toISOString(),
      isReadByAdmin: true,
    };
    setReplyText('');
    try {
      await db.collection('supportMessages').add(newMsg);
    } catch (e) {
      Alert.alert('Sync Error', 'Could not send the reply.');
    }
  };

  if (loading) {
    return (
      <View className="flex-1 justify-center items-center bg-white">
        <ActivityIndicator color={COLORS.brand.green} />
      </View>
    );
  }

  // ── Thread list ──────────────────────────────────────────────────────────
  if (!openPhone) {
    const totalUnread = allMessages.filter(isUnreadForAdmin).length;
    return (
      <View className="flex-1 bg-white">
        <View className="bg-slate-900 px-4 pb-4 border-b-4 border-black" style={{ paddingTop: insets.top + 16 }}>
          <Text className="text-[10px] font-mono font-black text-slate-500 uppercase tracking-widest mb-1">
            FoodyzzHQ
          </Text>
          <View className="flex-row items-center gap-2">
            <Text className="text-2xl font-black text-white uppercase tracking-tighter">
              Chat<Text className="text-brand-green"> Center</Text>
            </Text>
            {totalUnread > 0 && (
              <View className="bg-brand-green rounded-full min-w-[20px] h-5 px-1.5 items-center justify-center border-2 border-black">
                <Text className="text-black text-[9px] font-black">{totalUnread}</Text>
              </View>
            )}
          </View>
        </View>

        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          {threads.length === 0 ? (
            <View className="mt-16 mx-4 p-10 bg-slate-50 border-2 border-dashed border-slate-200 rounded-[32px] items-center">
              <MessageSquare size={32} color="#cbd5e1" />
              <Text className="text-slate-400 font-bold text-center text-xs mt-3 uppercase leading-relaxed">
                No conversations yet.{"\n"}Customer and provider chats appear here.
              </Text>
            </View>
          ) : (
            threads.map(([phone, msgs]) => {
              const last = msgs[msgs.length - 1];
              const unread = msgs.filter(isUnreadForAdmin).length;
              const isProvider = last?.userRole === 'provider';
              return (
                <TouchableOpacity
                  key={phone}
                  onPress={() => openThread(phone)}
                  className="flex-row items-center gap-3 px-4 py-4 border-b-2 border-slate-100"
                >
                  <View className={`w-10 h-10 rounded-2xl items-center justify-center border-2 border-black ${isProvider ? 'bg-emerald-100' : 'bg-indigo-100'}`}>
                    {isProvider ? <Building2 size={18} color="#059669" /> : <UserIcon size={18} color="#4f46e5" />}
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2">
                      <Text numberOfLines={1} className="flex-1 text-sm font-black text-slate-900 uppercase tracking-tight">
                        {last?.userName || phone}
                      </Text>
                      <Text className="text-[8px] font-mono font-black text-slate-300 uppercase">
                        {isProvider ? 'Provider' : 'Customer'}
                      </Text>
                    </View>
                    <Text numberOfLines={1} className="text-[11px] font-bold text-slate-400 mt-0.5">
                      {last?.senderPhone === 'admin' ? 'You: ' : ''}{last?.text}
                    </Text>
                  </View>
                  {unread > 0 && (
                    <View className="bg-rose-500 rounded-full min-w-[20px] h-5 px-1.5 items-center justify-center border-2 border-black">
                      <Text className="text-white text-[9px] font-black">{unread > 9 ? '9+' : unread}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      </View>
    );
  }

  // ── Open thread ──────────────────────────────────────────────────────────
  const openThreadArr = threads.find(([p]) => p === openPhone)?.[1] || [];
  const header = openThreadArr[0];
  const headerIsProvider = header?.userRole === 'provider';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-white"
    >
      <View className="bg-slate-900 px-4 pb-4 border-b-4 border-black flex-row items-center gap-3" style={{ paddingTop: insets.top + 12 }}>
        <TouchableOpacity
          onPress={() => setOpenPhone(null)}
          className="p-2 bg-slate-800 rounded-xl border-2 border-black"
        >
          <ArrowLeft size={18} color="white" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-[9px] font-mono font-black text-brand-green uppercase tracking-widest leading-none">
            {headerIsProvider ? 'Provider' : 'Customer'} · {openPhone}
          </Text>
          <Text numberOfLines={1} className="text-sm font-black text-white uppercase tracking-tight leading-none mt-1">
            {header?.userName || openPhone}
          </Text>
        </View>
      </View>

      {/*
        Message list virtualized as a FlatList so off-screen bubbles unmount — a long
        thread previously .map-ed every message inside a ScrollView. Order is unchanged
        (openMessages is already ascending), styling per-bubble is identical, and
        newest-at-bottom auto-scroll is preserved via onContentSizeChange->scrollToEnd
        (plus the existing length-change effect). NOTE: verify scroll/paint on device.
      */}
      <FlatList
        ref={scrollViewRef}
        data={openMessages}
        keyExtractor={(item, index) => item.id || String(index)}
        className="flex-1"
        contentContainerStyle={{ padding: 16 }}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item: msg }) => {
          const isAdmin = msg.senderPhone === 'admin';
          const isBot = msg.senderPhone === 'system';
          return (
            <View className={`flex-row ${isAdmin ? 'justify-end' : 'justify-start'} mb-4`}>
              <View className={`max-w-[85%] p-3 rounded-2xl border-2 border-black shadow-sm ${
                isAdmin ? 'bg-brand-green rounded-tr-none' : isBot ? 'bg-slate-100 border-dashed rounded-tl-none' : 'bg-white rounded-tl-none'
              }`}>
                <Text className={`text-[8px] font-mono font-black uppercase mb-1 ${isAdmin ? 'text-black/40' : 'text-slate-400'}`}>
                  {msg.senderName}
                </Text>
                <Text className={`text-[11px] font-bold leading-relaxed ${isAdmin ? 'text-black' : 'text-slate-800'}`}>
                  {msg.text}
                </Text>
                <Text className={`text-[7.5px] font-mono font-black uppercase mt-2 text-right ${isAdmin ? 'text-black/40' : 'text-slate-400'}`}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            </View>
          );
        }}
      />

      <View
        className="px-4 pt-4 bg-slate-900 border-t-4 border-black flex-row items-center gap-3"
        style={{ paddingBottom: insets.bottom + 12 }}
      >
        <TextInput
          value={replyText}
          onChangeText={setReplyText}
          placeholder="Reply as FoodyzzHQ..."
          placeholderTextColor="#94a3b8"
          className="flex-1 bg-white border-2 border-slate-200 rounded-2xl px-4 py-3 text-xs font-bold text-slate-900"
        />
        <TouchableOpacity
          onPress={handleSend}
          disabled={!replyText.trim()}
          className={`w-12 h-12 rounded-2xl items-center justify-center border-2 border-black shadow-brutalist ${
            replyText.trim() ? 'bg-brand-green' : 'bg-slate-800 opacity-50'
          }`}
        >
          <Send size={18} color="black" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
