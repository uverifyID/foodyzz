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
import { ArrowLeft, Send, MessageSquare, User as UserIcon, Building2, Package } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { db } from '../services/firebase';
import { COLORS } from '../theme';
import { SupportMessage } from '../types';

// Is this an incoming (customer/provider) message that HQ hasn't read yet?
const isUnreadForAdmin = (m: SupportMessage) =>
  !m.isReadByAdmin && m.senderPhone !== 'admin' && m.senderPhone !== 'system';

// How many order threads stay hydrated with live order context. Every id costs one
// providerOrders listener, so this is deliberately bounded — older threads are still
// reachable from the order card in Dispatch / Operations.
const MAX_ORDER_THREADS = 30;

// One row in the merged inbox. `kind` is the whole point of this screen: an order
// thread (started from the customer's order card) and a general thread (started
// from the customer's chat tab) land in the same list and must be tellable apart.
type Thread = {
  key: string;
  kind: 'order' | 'general';
  orderId?: string;
  userPhone: string;
  userName: string;
  isProvider: boolean;
  lastText: string;
  lastFromHq: boolean;
  lastAt: string;
  unread: number;
};

// FoodyzzHQ one-to-many chat manager — the single inbox for everything customers
// and providers send:
//   • general threads  → `supportMessages`, bucketed per userPhone. Replies are
//     written back as senderPhone:'admin' so onAdminReplyToSupport pushes them to
//     the user's device; they open in the customer's chat tab. Handled inline here.
//   • order threads    → `messages`, bucketed per orderId. Tapping one opens the
//     existing per-order chat screen (which already carries the order header and
//     clears the unread flag), so there's exactly one order-chat UI in this app.
export default function HqChatScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const [allMessages, setAllMessages] = useState<SupportMessage[]>([]);
  const [orderMessages, setOrderMessages] = useState<any[]>([]);
  const [orderCtx, setOrderCtx] = useState<Record<string, any>>({});
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

  // Order-scoped chat. Same bound + reverse as above; single-field ordering so no
  // composite index is needed.
  useEffect(() => {
    const unsub = db.collection('messages')
      .orderBy('timestamp', 'desc')
      .limit(500)
      .onSnapshot((snapshot) => {
        if (!snapshot) return;
        setOrderMessages(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)).reverse());
      }, (error) => {
        console.error('Error fetching order messages:', error);
      });
    return unsub;
  }, []);

  // Order threads, newest-active first, grouped once (not re-filtered per id).
  const orderThreadMsgs = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const m of orderMessages) {
      if (!m.orderId) continue;
      const bucket = map.get(m.orderId);
      if (bucket) bucket.push(m); else map.set(m.orderId, [m]);
    }
    return [...map.entries()]
      .sort((a, b) => String(b[1][b[1].length - 1]?.timestamp || '').localeCompare(String(a[1][a[1].length - 1]?.timestamp || '')))
      .slice(0, MAX_ORDER_THREADS);
  }, [orderMessages]);

  // The chat docs carry only an orderId, so customer name + the unread flag come
  // from the provider-safe order mirror. Keyed on the id list so the listeners are
  // only torn down when the set of live threads actually changes.
  const orderIdKey = orderThreadMsgs.map(([id]) => id).join('|');
  useEffect(() => {
    const ids = orderIdKey ? orderIdKey.split('|') : [];
    const unsubs = ids.map((id) =>
      db.collection('providerOrders').doc(id).onSnapshot(
        (snap) => { if (snap?.exists) setOrderCtx((prev) => ({ ...prev, [id]: snap.data() })); },
        () => {/* a missing/denied mirror just leaves the row unlabelled */},
      ));
    return () => unsubs.forEach((u) => u());
  }, [orderIdKey]);

  // Bucket support messages into threads keyed by userPhone.
  const supportThreads = useMemo(() => {
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

  // The merged inbox.
  const threads: Thread[] = useMemo(() => {
    const rows: Thread[] = supportThreads.map(([phone, msgs]) => {
      const last = msgs[msgs.length - 1];
      return {
        key: `general:${phone}`,
        kind: 'general' as const,
        userPhone: phone,
        userName: last?.userName || phone,
        isProvider: last?.userRole === 'provider',
        lastText: last?.text || '',
        lastFromHq: last?.senderPhone === 'admin' || last?.senderPhone === 'system',
        lastAt: last?.timestamp || '',
        unread: msgs.filter(isUnreadForAdmin).length,
      };
    });

    for (const [orderId, msgs] of orderThreadMsgs) {
      const last = msgs[msgs.length - 1];
      const ctx = orderCtx[orderId];
      // `messages` has no per-message read flag; the order carries one
      // (providerUnreadMessage, set by onCustomerMessageSent and cleared when the
      // order chat is opened). Count the unanswered customer messages at the tail
      // so the badge shows how many are actually waiting.
      let unread = 0;
      if (ctx?.providerUnreadMessage) {
        for (let i = msgs.length - 1; i >= 0 && msgs[i].senderRole === 'customer'; i--) unread++;
        unread = Math.max(1, unread);
      }
      rows.push({
        key: `order:${orderId}`,
        kind: 'order',
        orderId,
        userPhone: ctx?.customerPhone || '',
        userName: ctx?.customerName || 'Customer',
        isProvider: false,
        lastText: last?.text || '',
        lastFromHq: last?.senderRole !== 'customer',
        lastAt: last?.timestamp || '',
        unread,
      });
    }

    return rows.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }, [supportThreads, orderThreadMsgs, orderCtx]);

  const openMessages = openPhone ? (supportThreads.find(([p]) => p === openPhone)?.[1] || []) : [];

  useEffect(() => {
    if (openPhone && scrollViewRef.current) {
      scrollViewRef.current.scrollToEnd({ animated: true });
    }
  }, [openMessages.length, openPhone]);

  // Mark all incoming messages in a thread as read by admin.
  const markThreadRead = async (phone: string) => {
    const unread = (supportThreads.find(([p]) => p === phone)?.[1] || []).filter(isUnreadForAdmin);
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

  const openGeneralThread = (phone: string) => {
    setOpenPhone(phone);
    setReplyText('');
    markThreadRead(phone);
  };

  const openThread = (t: Thread) => {
    if (t.kind === 'order' && t.orderId) {
      // The per-order chat screen already owns the order header and the unread
      // reset — reuse it rather than growing a second order-chat UI here.
      navigation.navigate('Chat', { orderId: t.orderId });
      return;
    }
    openGeneralThread(t.userPhone);
  };

  // Deep link from a push tap: open the thread the notification was about.
  useEffect(() => {
    const orderId = route.params?.openOrderId;
    const phone = route.params?.openPhone;
    if (orderId) {
      navigation.setParams({ openOrderId: undefined });
      navigation.navigate('Chat', { orderId });
    } else if (phone) {
      navigation.setParams({ openPhone: undefined });
      openGeneralThread(phone);
    }
  }, [route.params?.openOrderId, route.params?.openPhone]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = async () => {
    const text = replyText.trim();
    if (!text || !openPhone) return;
    const thread = supportThreads.find(([p]) => p === openPhone)?.[1] || [];
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
    const totalUnread = threads.reduce((n, t) => n + t.unread, 0);
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
          {/* The legend, because the whole point of merging the two inboxes is that
              you can tell at a glance which one a message came from. */}
          <View className="flex-row items-center gap-4 mt-2">
            <View className="flex-row items-center gap-1.5">
              <View className="w-2.5 h-2.5 rounded-full bg-amber-400 border border-black" />
              <Text className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Order chat</Text>
            </View>
            <View className="flex-row items-center gap-1.5">
              <View className="w-2.5 h-2.5 rounded-full bg-indigo-400 border border-black" />
              <Text className="text-[8px] font-black text-slate-400 uppercase tracking-widest">General</Text>
            </View>
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
            threads.map((t) => {
              const isOrder = t.kind === 'order';
              return (
                <TouchableOpacity
                  key={t.key}
                  onPress={() => openThread(t)}
                  style={isOrder ? { borderLeftWidth: 5, borderLeftColor: '#f59e0b' } : undefined}
                  className={`flex-row items-center gap-3 px-4 py-4 border-b-2 border-slate-100 ${isOrder ? 'bg-amber-50/60' : ''}`}
                >
                  <View className={`w-10 h-10 rounded-2xl items-center justify-center border-2 border-black ${
                    isOrder ? 'bg-amber-100' : t.isProvider ? 'bg-emerald-100' : 'bg-indigo-100'
                  }`}>
                    {isOrder
                      ? <Package size={18} color="#b45309" />
                      : t.isProvider
                        ? <Building2 size={18} color="#059669" />
                        : <UserIcon size={18} color="#4f46e5" />}
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2">
                      <Text numberOfLines={1} className="flex-1 text-sm font-black text-slate-900 uppercase tracking-tight">
                        {t.userName}
                      </Text>
                      {isOrder ? (
                        <View className="bg-amber-400 px-1.5 py-0.5 rounded border border-black">
                          <Text className="text-[8px] font-mono font-black text-black uppercase">
                            Order {t.orderId!.replace(/^order_/, '#')}
                          </Text>
                        </View>
                      ) : (
                        <Text className="text-[8px] font-mono font-black text-slate-300 uppercase">
                          {t.isProvider ? 'Provider' : 'General'}
                        </Text>
                      )}
                    </View>
                    <Text numberOfLines={1} className="text-[11px] font-bold text-slate-400 mt-0.5">
                      {t.lastFromHq ? 'You: ' : ''}{t.lastText}
                    </Text>
                  </View>
                  {t.unread > 0 && (
                    <View className="bg-rose-500 rounded-full min-w-[20px] h-5 px-1.5 items-center justify-center border-2 border-black">
                      <Text className="text-white text-[9px] font-black">{t.unread > 9 ? '9+' : t.unread}</Text>
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

  // ── Open general thread ──────────────────────────────────────────────────
  const openThreadArr = supportThreads.find(([p]) => p === openPhone)?.[1] || [];
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
            {headerIsProvider ? 'Provider' : 'Customer'} · General · {openPhone}
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
        (plus the existing length-change effect).
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
