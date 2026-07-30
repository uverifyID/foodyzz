// The ONE chat screen the customer ever sees.
//
// There used to be two — SupportScreen (global FoodyzzHQ thread, WhatsApp-styled)
// and this one (per-order thread, brutalist) — with different layouts, different
// bubbles and different bugs. A customer has no idea why "chat" looks different
// depending on where they tapped, so both entry points now render THIS screen:
//
//   Chat tab / Account → Support   → no `orderId` param → general FoodyzzHQ thread
//                                    (`supportMessages`, tagged source:'footer')
//   My Rentals → order card Chat   → `orderId` param    → that order's thread
//                                    (`messages`, tagged source:'order')
//
// The customer sees one design either way. The order/non-order distinction is
// carried in the data (collection + `source` + `orderId`) so FoodyzzHQ can tell
// them apart in its Chat Center — that's where the difference is meant to show.
import React, { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback } from 'react';
import {
    View,
    Text,
    FlatList,
    TouchableOpacity,
    TextInput,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Alert,
} from 'react-native';
import { ArrowLeft, Send, MessageSquare, Clock } from 'lucide-react-native';
import { useNavigation, useRoute, useIsFocused } from '@react-navigation/native';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { auth, db } from '../services/firebase';
import { COLORS } from '../theme';
import { AppRole } from '../types';
import { useUserProfile } from '../context/UserProfileContext';
import { logHandledError } from '../services/errors';

// One shape for both threads so the renderer never branches on the collection.
type ChatMessage = {
    id: string;
    text: string;
    timestamp: string;
    mine: boolean;
    senderName?: string;
    // A message that's been written locally but hasn't come back on the snapshot
    // yet. Rendered immediately (dimmed) so a sent message is ALWAYS visible the
    // instant it's sent — the old screen relied entirely on the listener echo,
    // which is what made "hello" appear only after closing and reopening chat.
    pending?: boolean;
};

const newMessageId = () => `msg_${Math.random().toString(36).substring(2, 11).toUpperCase()}`;

export default function ChatScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<any>();
    const isFocused = useIsFocused();
    const insets = useSafeAreaInsets();
    // This screen mounts twice over: as the Chat tab, and as the Support/OrderChat
    // stack routes. useSafeAreaInsets always reports window insets (bottom-tabs
    // never narrows them), but under the tab navigator the tab bar already covers
    // the nav bar — so the inset only belongs to the composer on the stack routes.
    // Non-null here means we are inside the tab navigator.
    const tabBarHeight = React.useContext(BottomTabBarHeightContext);
    const composerInset = tabBarHeight == null ? insets.bottom : 0;
    // Present → order-scoped thread. Absent → global FoodyzzHQ thread.
    const orderId: string | undefined = route.params?.orderId;
    const isOrderThread = !!orderId;

    // `auth` is the RN-Firebase module factory — it must be CALLED to get the
    // instance. Reading `auth.currentUser` (no parens) is always undefined, which
    // made the send handler bail at the `!user?.phoneNumber` guard so customer
    // messages never reached FoodyzzHQ.
    const user = auth().currentUser;
    const { profile } = useUserProfile();
    const [inputText, setInputText] = useState('');
    const [remote, setRemote] = useState<ChatMessage[]>([]);
    const [pending, setPending] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(true);
    // Set when the thread listener dies. A Firestore listener that errors (a missing
    // composite index, for one) stops delivering snapshots for good: inbound messages
    // never arrive and the customer's own sends stay stuck dimmed. That used to be
    // silent — console-only — so the thread just looked half-empty. Say so instead.
    const [listenerFailed, setListenerFailed] = useState(false);
    const [orderData, setOrderData] = useState<any>(null);
    const listRef = useRef<FlatList<ChatMessage>>(null);
    // Whether the view is parked at the newest message. Auto-scroll is gated on this:
    // scrolling to the end on EVERY content-size change drags the user back down the
    // moment virtualization renders another row, so they can never read history.
    // A ref, not state — it changes on every scroll frame and must not re-render.
    const atBottomRef = useRef(true);

    // Optimistic echoes that the snapshot has now confirmed are DROPPED FROM STATE,
    // not merely filtered at render time: filtering alone would leave every message
    // ever sent sitting in `pending` for the life of the screen.
    useEffect(() => {
        if (pending.length === 0) return;
        const confirmed = new Set(remote.map((m) => m.id));
        setPending((prev) => {
            const next = prev.filter((p) => !confirmed.has(p.id));
            return next.length === prev.length ? prev : next;
        });
    }, [remote]); // eslint-disable-line react-hooks/exhaustive-deps

    const messages = useMemo(() => {
        if (pending.length === 0) return remote;
        const confirmed = new Set(remote.map((m) => m.id));
        return [...remote, ...pending.filter((p) => !confirmed.has(p.id))];
    }, [remote, pending]);

    // This screen draws its own header bar (see `header` below) instead of using the
    // native one. On iOS 26 UIKit gives every custom headerLeft/headerRight view a
    // "shared background" capsule: it painted a light pill behind the back button —
    // opaque against the page rather than transparent — and clipped the bottom of the
    // button's black border, because the capsule is shorter than the bordered box.
    // react-native-screens 4.11 exposes no way to opt a bar item out of it, so the
    // only reliable fix is not to use bar items at all.
    useLayoutEffect(() => {
        navigation.setOptions({ headerShown: false });
    }, [navigation]);

    // Switching between threads (tab → order card) must not leak the previous
    // thread's bubbles into the new one for a frame.
    useEffect(() => {
        setRemote([]);
        setPending([]);
        setLoading(true);
        setListenerFailed(false);
    }, [orderId]);

    // ── Order-scoped thread: `messages` where orderId == ─────────────────────
    useEffect(() => {
        if (!isOrderThread) return;

        // Order context for the header + clear the customer unread flag so the My
        // Rentals card alert resets on open (mirror of the provider side clearing
        // providerUnreadMessage).
        const orderRef = db.collection('orders').doc(orderId!);
        orderRef.get()
            .then((snap) => {
                if (!snap?.exists) return;
                setOrderData(snap.data());
                if (snap.data()?.customerUnreadMessage) {
                    orderRef.update({ customerUnreadMessage: false }).catch(() => {});
                }
            })
            .catch((e) => logHandledError('chat:order-context', e));

        // Bound the read: only the 100 most recent (DESC + limit) instead of the
        // whole thread, then reverse so display stays oldest→newest.
        const unsub = db.collection('messages')
            .where('orderId', '==', orderId)
            .orderBy('timestamp', 'desc')
            .limit(100)
            .onSnapshot((snapshot) => {
                if (!snapshot) return;
                setRemote(snapshot.docs.map((d) => {
                    const data = d.data() as any;
                    return {
                        id: d.id,
                        text: data.text,
                        timestamp: data.timestamp,
                        mine: data.senderRole === AppRole.CUSTOMER,
                        senderName: data.senderName || 'FoodyzzHQ',
                    };
                }).reverse());
                setListenerFailed(false);
                setLoading(false);
            }, (error) => {
                logHandledError('chat:order-messages', error);
                setListenerFailed(true);
                setLoading(false);
            });

        return unsub;
    }, [orderId, isOrderThread]);

    // ── General thread: `supportMessages` where userPhone == ─────────────────
    useEffect(() => {
        if (isOrderThread) return;
        const phone = user?.phoneNumber;
        if (!phone) return;

        const unsub = db.collection('supportMessages')
            .where('userPhone', '==', phone)
            .orderBy('timestamp', 'desc')
            .limit(100)
            .onSnapshot((snapshot) => {
                if (!snapshot) return;
                setRemote(snapshot.docs.map((d) => {
                    const data = d.data() as any;
                    return {
                        id: d.id,
                        text: data.text,
                        timestamp: data.timestamp,
                        mine: data.senderPhone === phone,
                        senderName: data.senderName || 'FoodyzzHQ',
                    };
                }).reverse());
                setListenerFailed(false);
                setLoading(false);
            }, (error) => {
                logHandledError('chat:support-messages', error);
                setListenerFailed(true);
                setLoading(false);
            });

        return unsub;
    }, [user, isOrderThread]);

    // While the general thread is open, stamp it read so the Chat tab's unread dot
    // clears. Fires once on focus — `remote` is intentionally NOT a dependency,
    // otherwise it would re-write the doc on every inbound message.
    useEffect(() => {
        if (isOrderThread || !isFocused || !user?.phoneNumber) return;
        db.collection('users').doc(user.phoneNumber)
            .set({ supportLastReadAt: new Date().toISOString() }, { merge: true })
            .catch(() => {});
    }, [isFocused, user, isOrderThread]);

    const handleSend = useCallback(async () => {
        const text = inputText.trim();
        const phone = user?.phoneNumber;
        if (!text || !phone) return;

        const msgId = newMessageId();
        const timestamp = new Date().toISOString();
        const senderName = profile?.name || 'Customer';

        // Show it immediately, clear the box, then write.
        // Your own message always pulls the view back down, wherever you were.
        atBottomRef.current = true;
        setPending((prev) => [...prev, { id: msgId, text, timestamp, mine: true, senderName, pending: true }]);
        setInputText('');

        try {
            if (isOrderThread) {
                await db.collection('messages').doc(msgId).set({
                    id: msgId,
                    orderId,
                    senderPhone: phone,
                    senderName,
                    senderRole: AppRole.CUSTOMER,
                    // Lets FoodyzzHQ tell an order thread from the global one without
                    // inferring it from the collection.
                    source: 'order',
                    text,
                    timestamp,
                });
            } else {
                await db.collection('supportMessages').doc(msgId).set({
                    userPhone: phone,
                    userName: senderName,
                    userRole: AppRole.CUSTOMER,
                    senderPhone: phone,
                    senderName,
                    source: 'footer',
                    text,
                    timestamp,
                    isReadByAdmin: false, // FoodyzzHQ marks it read when it opens the thread
                });
            }
        } catch (error) {
            setPending((prev) => prev.filter((m) => m.id !== msgId));
            setInputText(text);
            Alert.alert('Connection Error', 'Message could not be sent. Please try again.');
        }
    }, [inputText, user, profile, isOrderThread, orderId]);

    // The header the native bar used to render. Nothing here sits in a UIKit bar item,
    // so no capsule is drawn behind the back button and its border can't be clipped.
    // insets.top stands in for the status-bar space the native header reserved.
    const header = (
        <View style={{ paddingTop: insets.top }} className="bg-white border-b-4 border-black">
            {/* pb-4, not py-2: the back button is the tallest thing in the row (18pt icon
                + p-2 + its 2pt border), and at 8pt it sat right on the 4pt bottom rule —
                the button's lower border and the third title line both read as touching
                it. The top stays at 8pt since insets.top already spaces the row off the
                status bar. */}
            <View className="flex-row items-center px-4 pt-2 pb-4">
                {/* As the Chat tab there's nothing to go back to, so only show the arrow
                    when this screen was pushed (order card / Account → Support). */}
                {navigation.canGoBack() && (
                    <TouchableOpacity
                        onPress={() => navigation.goBack()}
                        className="p-2 bg-slate-100 rounded-xl border-2 border-black mr-3"
                    >
                        <ArrowLeft size={18} color="black" />
                    </TouchableOpacity>
                )}
                <View className="flex-1">
                    <Text className="text-[8px] font-mono font-black text-indigo-600 uppercase tracking-widest leading-none">
                        {isOrderThread ? 'Order Dispatch' : 'Direct Line'}
                    </Text>
                    <Text className="text-sm font-black text-black uppercase tracking-tight leading-none">
                        {isOrderThread ? (orderData?.providerName || 'Assigning Partner...') : 'FoodyzzHQ'}
                    </Text>
                    <Text className="text-[7px] font-mono text-slate-400 font-bold uppercase mt-0.5">
                        {isOrderThread ? `REF: ${orderId!.replace(/^order_/, '')}` : 'We usually reply in minutes'}
                    </Text>
                </View>
                <View className="bg-indigo-50 px-2 py-0.5 rounded-lg border-2 border-indigo-600 ml-2">
                    <Text className="text-[8px] font-black text-indigo-600 uppercase">Secure Line</Text>
                </View>
            </View>
        </View>
    );

    if (loading) {
        return (
            <View className="flex-1 bg-white">
                {header}
                <View className="flex-1 justify-center items-center">
                    <ActivityIndicator color={COLORS.brand.greenDark} />
                </View>
            </View>
        );
    }

    return (
        <View className="flex-1 bg-slate-50">
            {header}
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                // The header is now a sibling above this view, so this view's bottom edge
                // IS the screen bottom — the keyboard overlap is exactly its own height
                // and needs no header offset.
                className="flex-1 bg-slate-50"
            >
            {/* Virtualized so a long thread doesn't mount every bubble. Auto-scroll is
                driven by onContentSizeChange rather than a messages-length effect: the
                effect fired BEFORE the new bubble had laid out, so the list stopped
                short of the bottom and a just-sent message sat below the fold. */}
            <FlatList
                ref={listRef}
                data={messages}
                keyExtractor={(item) => item.id}
                className="flex-1"
                contentContainerStyle={{ padding: 16, flexGrow: 1 }}
                showsVerticalScrollIndicator={false}
                onScroll={(e) => {
                    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
                    atBottomRef.current = layoutMeasurement.height + contentOffset.y >= contentSize.height - 80;
                }}
                // Coarse on purpose: this only needs a rough "are we at the bottom",
                // so 200ms keeps the scroll events off the bridge at 60fps.
                scrollEventThrottle={200}
                onContentSizeChange={() => {
                    if (atBottomRef.current) listRef.current?.scrollToEnd({ animated: true });
                }}
                onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
                ListEmptyComponent={
                    <View className="mt-10 p-10 bg-white border-2 border-dashed border-slate-200 rounded-[32px] items-center">
                        <MessageSquare size={32} color="#cbd5e1" />
                        <Text className="text-slate-400 font-bold text-center text-xs mt-3 uppercase leading-relaxed">
                            {isOrderThread
                                ? 'Dispatch Line Connected.\nContact the team about your rental.'
                                : 'Chat with FoodyzzHQ.\nAsk us anything — we reply fast.'}
                        </Text>
                    </View>
                }
                renderItem={({ item: m }) => (
                    <View className={`flex-row ${m.mine ? 'justify-end' : 'justify-start'} mb-4`}>
                        <View
                            style={m.pending ? { opacity: 0.6 } : undefined}
                            className={`max-w-[85%] p-3 rounded-2xl border-2 border-black shadow-sm ${
                                m.mine ? 'bg-indigo-600 rounded-tr-none' : 'bg-white rounded-tl-none'
                            }`}
                        >
                            {!m.mine && (
                                <Text className="text-[8px] font-mono font-black uppercase mb-1 text-slate-400">
                                    {m.senderName}
                                </Text>
                            )}
                            <Text className={`text-[11px] font-bold leading-relaxed ${m.mine ? 'text-white' : 'text-slate-800'}`}>
                                {m.text}
                            </Text>
                            <View className="flex-row items-center justify-end gap-1 mt-2">
                                {m.pending && <Clock size={8} color={m.mine ? '#c7d2fe' : '#94a3b8'} />}
                                <Text className={`text-[7.5px] font-mono font-black uppercase ${m.mine ? 'text-indigo-200' : 'text-slate-400'}`}>
                                    {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </Text>
                            </View>
                        </View>
                    </View>
                )}
            />

            {listenerFailed && (
                <View className="mx-4 mb-2 px-3 py-2 bg-amber-50 border-2 border-amber-400 rounded-xl">
                    <Text className="text-[9px] font-mono font-black text-amber-700 uppercase">
                        Live updates interrupted
                    </Text>
                    <Text className="text-[10px] font-bold text-amber-700 mt-0.5 leading-relaxed">
                        New replies may not appear. Reopen this chat to reconnect.
                    </Text>
                </View>
            )}

            {/* Input Control Block */}
            <View
                className="px-4 pt-4 bg-white border-t-4 border-black flex-row items-center gap-3"
                style={{ paddingBottom: composerInset + 28 }}
            >
                <TextInput
                    value={inputText}
                    onChangeText={setInputText}
                    placeholder={isOrderThread ? 'Message about this order...' : 'Message FoodyzzHQ...'}
                    placeholderTextColor="#94a3b8"
                    className="flex-1 bg-slate-50 border-2 border-black rounded-2xl px-4 py-3 text-xs font-bold text-black focus:bg-stone-50"
                />
                <TouchableOpacity
                    onPress={handleSend}
                    disabled={!inputText.trim()}
                    className={`w-12 h-12 rounded-2xl items-center justify-center border-2 border-black shadow-brutalist ${
                        inputText.trim() ? 'bg-white' : 'bg-slate-200 opacity-50'
                    }`}
                >
                    <Send size={18} color={inputText.trim() ? '#507425' : '#94a3b8'} />
                </TouchableOpacity>
            </View>
            </KeyboardAvoidingView>
        </View>
    );
}
