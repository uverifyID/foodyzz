import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    TextInput,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Alert
} from 'react-native';
import { ArrowLeft, Send, MessageSquare } from 'lucide-react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { auth, db } from '../services/firebase';
import { COLORS, LAYOUT } from '../theme';
import { AppRole } from '../types';

export default function ChatScreen() {
    const navigation = useNavigation();
    const route = useRoute();
    const insets = useSafeAreaInsets();
    const headerHeight = useHeaderHeight();
    const { orderId } = route.params as { orderId: string };

    // `auth` is the RN-Firebase module factory — it must be CALLED to get the
    // instance. Reading `auth.currentUser` (no parens) is always undefined, which
    // made handleSendMessage bail at the `!user?.phoneNumber` guard so customer
    // messages never reached the provider.
    const user = auth().currentUser;
    const [inputText, setInputText] = useState('');
    const [messages, setMessages] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [orderData, setOrderData] = useState<any>(null);
    const scrollViewRef = useRef<ScrollView>(null);

    // In the independent Customer app, the role is fixed. 
    // For the Provider app version, this would be set to 'provider'.
    const SENDER_ROLE = AppRole.CUSTOMER;

    useLayoutEffect(() => {
        navigation.setOptions({
            headerShown: true,
            headerTitle: () => (
                <View>
                    <Text className="text-[8px] font-mono font-black text-indigo-600 uppercase tracking-widest leading-none">Order Dispatch</Text>
                    <Text className="text-sm font-black text-black uppercase tracking-tight leading-none">{orderData?.providerName || 'Assigning Partner...'}</Text>
                    <Text className="text-[7px] font-mono text-slate-400 font-bold uppercase mt-0.5">REF: {orderId.replace(/^order_/, '')}</Text>
                </View>
            ),
            headerTitleAlign: 'left',
            headerLeft: () => (
                <TouchableOpacity
                    onPress={() => navigation.goBack()}
                    className="p-2 bg-slate-100 rounded-xl border-2 border-black ml-4 mr-2"
                >
                    <ArrowLeft size={18} color="black" />
                </TouchableOpacity>
            ),
            headerRight: () => (
                <View className="bg-indigo-50 px-2 py-0.5 rounded-lg border-2 border-indigo-600 mr-4">
                    <Text className="text-[8px] font-black text-indigo-600 uppercase">Secure Line</Text>
                </View>
            ),
            headerStyle: { elevation: 0, shadowOpacity: 0, borderBottomWidth: 4, borderBottomColor: 'black', backgroundColor: 'white' },
        });
    }, [navigation, orderData, orderId]);

    useEffect(() => {
        if (!orderId) return;

        // 1. Fetch Order Details for Header Information, and clear the customer
        //    unread flag so the My Rentals card alert resets on open (mirror of
        //    the provider side clearing providerUnreadMessage).
        const fetchOrder = async () => {
            try {
                const orderRef = db.collection('orders').doc(orderId);
                const orderSnap = await orderRef.get();
                if (orderSnap && orderSnap.exists) {
                    setOrderData(orderSnap.data());
                    if (orderSnap.data()?.customerUnreadMessage) {
                        orderRef.update({ customerUnreadMessage: false }).catch(() => {});
                    }
                }
            } catch (error) {
                console.error("Error fetching order context:", error);
            }
        };
        fetchOrder();

        // 2. Subscribe to Real-Time Messages for this specific Order.
        //    Bound the read: fetch only the 100 most recent (DESC + limit) instead
        //    of the whole thread, then reverse so display stays oldest→newest.
        const unsub = db.collection('messages')
            .where('orderId', '==', orderId)
            .orderBy('timestamp', 'desc')
            .limit(100)
            .onSnapshot((snapshot) => {
            if (!snapshot) return;
            const msgs = snapshot.docs.map(d => ({
                id: d.id,
                ...d.data()
            })).reverse();
            setMessages(msgs);
            setLoading(false);
        }, (error) => {
            console.error("Firestore Messaging Error:", error);
            setLoading(false);
        });

        return unsub;
    }, [orderId]);

    useEffect(() => {
        // Auto-scroll to the most recent message
        if (scrollViewRef.current) {
            scrollViewRef.current.scrollToEnd({ animated: true });
        }
    }, [messages]);

    const handleSendMessage = async () => {
        if (!inputText.trim() || !user?.phoneNumber) return;

        // Generate visually relatable Document ID as per requirements
        const msgId = `msg_${Math.random().toString(36).substring(2, 11).toUpperCase()}`;
        const newMsg = {
            id: msgId,
            orderId,
            senderPhone: user.phoneNumber,
            senderRole: SENDER_ROLE,
            text: inputText.trim(),
            timestamp: new Date().toISOString()
        };

        try {
            await db.collection('messages').doc(msgId).set(newMsg);
            setInputText('');
        } catch (error) {
            Alert.alert("Connection Error", "Message could not be sent to the dispatch node.");
        }
    };

    if (loading) {
        return (
            <View className="flex-1 justify-center items-center bg-white">
                <ActivityIndicator color={COLORS.brand.greenDark} />
            </View>
        );
    }

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
            className="flex-1 bg-slate-50"
        >

            {/* Messaging Stream Feed */}
            <ScrollView
                ref={scrollViewRef}
                className="flex-1 p-4"
                showsVerticalScrollIndicator={false}
            >
                {messages.length === 0 ? (
                    <View className="mt-10 p-10 bg-white border-2 border-dashed border-slate-200 rounded-[32px] items-center">
                        <MessageSquare size={32} color="#cbd5e1" />
                        <Text className="text-slate-400 font-bold text-center text-xs mt-3 uppercase leading-relaxed">
                            Dispatch Line Connected.{"\n"}Contact the team about your rental.
                        </Text>
                    </View>
                ) : (
                    messages.map((m, i) => {
                        const isMe = m.senderRole === SENDER_ROLE;
                        return (
                            <View key={m.id || i} className={`flex-row ${isMe ? 'justify-end' : 'justify-start'} mb-4`}>
                                <View className={`max-w-[85%] p-3 rounded-2xl border-2 border-black shadow-sm ${isMe ? 'bg-indigo-600 rounded-tr-none' : 'bg-white rounded-tl-none'
                                    }`}>
                                    <Text className={`text-[11px] font-bold leading-relaxed ${isMe ? 'text-white' : 'text-slate-800'}`}>
                                        {m.text}
                                    </Text>
                                    <Text className={`text-[7.5px] font-mono font-black uppercase mt-2 text-right ${isMe ? 'text-indigo-200' : 'text-slate-400'}`}>
                                        {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </Text>
                                </View>
                            </View>
                        );
                    })
                )}
            </ScrollView>

            {/* Input Control Block */}
            <View
                className="px-4 pt-4 bg-white border-t-4 border-black flex-row items-center gap-3"
                style={{ paddingBottom: insets.bottom + 28 }}
            >
                <TextInput
                    value={inputText}
                    onChangeText={setInputText}
                    placeholder="Send a message..."
                    placeholderTextColor="#94a3b8"
                    className="flex-1 bg-slate-50 border-2 border-black rounded-2xl px-4 py-3 text-xs font-bold text-black focus:bg-stone-50"
                />
                <TouchableOpacity
                    onPress={handleSendMessage}
                    disabled={!inputText.trim()}
                    className={`w-12 h-12 rounded-2xl items-center justify-center border-2 border-black shadow-brutalist ${inputText.trim() ? 'bg-white' : 'bg-slate-200 opacity-50'
                        }`}
                >
                    <Send size={18} color={inputText.trim() ? '#507425' : '#94a3b8'} />
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
}
