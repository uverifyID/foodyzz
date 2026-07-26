import React, { useState, useEffect, useRef } from 'react';
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
import { auth, db } from '../services/firebase'; 
import { COLORS, LAYOUT } from '../theme';
import { AppRole } from '../types';

export default function ChatScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { orderId } = route.params as { orderId: string };
  
  const user = auth().currentUser;
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [orderData, setOrderData] = useState<any>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  // Provider role for the provider app version
  const SENDER_ROLE = AppRole.PROVIDER; 

  useEffect(() => {
    if (!orderId) return;

    const fetchOrder = async () => {
      try {
        // Read order context from the provider-safe mirror (no customer charge data).
        const orderSnap = await db.collection('providerOrders').doc(orderId).get();
        if (orderSnap.exists) {
          setOrderData(orderSnap.data());
          // Provider has opened the thread → clear the unread flag the customer's
          // message set, so the Operations feed badge / pink card reset to normal.
          // The flag lives on the real order doc (the mirror is read-only).
          if (orderSnap.data()?.providerUnreadMessage) {
            db.collection('orders').doc(orderId).update({ providerUnreadMessage: false }).catch(() => {});
          }
        }
      } catch (error) {
        console.error("Error fetching order context:", error);
      }
    };
    fetchOrder();

    const q = db.collection('messages')
      .where('orderId', '==', orderId)
      .orderBy('timestamp', 'asc');

    const unsubscribe = q.onSnapshot((snapshot) => {
      const msgs = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      setMessages(msgs);
      // Drop optimistic echoes once the real docs land.
      const ids = new Set(msgs.map((m: any) => m.id));
      setPending((prev) => prev.filter((p) => !ids.has(p.id)));
      setLoading(false);
    }, (error) => {
      console.error("Firestore Messaging Error:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [orderId]);

  const handleSendMessage = async () => {
    const text = inputText.trim();
    if (!text || !user?.phoneNumber) return;

    const msgId = `msg_${Math.random().toString(36).substring(2, 11).toUpperCase()}`;
    const newMsg = {
      id: msgId,
      orderId,
      senderPhone: user.phoneNumber,
      senderName: orderData?.providerName || 'FoodyzzHQ',
      senderRole: SENDER_ROLE,
      // Marks the thread as order-scoped for the FoodyzzHQ Chat Center, which
      // merges these with the general `supportMessages` threads.
      source: 'order',
      text,
      timestamp: new Date().toISOString()
    };

    // Render it immediately — waiting on the listener echo is what made a just-sent
    // message appear only after leaving and reopening the thread.
    setPending((prev) => [...prev, { ...newMsg, pending: true }]);
    setInputText('');

    try {
      await db.collection('messages').doc(msgId).set(newMsg);
    } catch (error) {
      setPending((prev) => prev.filter((m) => m.id !== msgId));
      setInputText(text);
      Alert.alert("Connection Error", "Message could not be sent.");
    }
  };

  // What actually renders: confirmed messages plus any still-unacknowledged sends.
  const visibleMessages = [...messages, ...pending];

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
      {/* Neo-Brutalist Header - Dark for Provider */}
      <View className="bg-slate-900 px-4 pt-12 pb-4 border-b-4 border-black flex-row items-center justify-between shadow-sm">
        <View className="flex-row items-center gap-3">
          <TouchableOpacity 
            onPress={() => navigation.goBack()} 
            className="p-2 bg-slate-800 rounded-xl border-2 border-black"
          >
            <ArrowLeft size={18} color="white" />
          </TouchableOpacity>
          <View>
            <Text className="text-[10px] font-mono font-black text-brand-green uppercase tracking-widest mb-0.5 leading-none">
              Secure Line
            </Text>
            <Text className="text-sm font-black text-white uppercase tracking-tight leading-none">
              {orderData?.customerName || 'Connecting...'}
            </Text>
            <Text className="text-[9px] font-mono text-slate-400 font-bold uppercase mt-1">
              REF: {orderId.replace(/^order_/, '')}
            </Text>
          </View>
        </View>
        <View className="bg-brand-green/10 px-2.5 py-1 rounded-lg border-2 border-brand-green">
           <Text className="text-[8px] font-black text-brand-green uppercase">Active Node</Text>
        </View>
      </View>

      {/* Auto-scroll is driven by onContentSizeChange rather than a messages-length
          effect: the effect fired BEFORE the new bubble laid out, so the list stopped
          short of the bottom and a just-sent message sat below the fold. */}
      <ScrollView
        ref={scrollViewRef}
        className="flex-1 p-4"
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
      >
        {visibleMessages.length === 0 ? (
          <View className="mt-10 p-10 bg-slate-50 border-2 border-dashed border-slate-200 rounded-[32px] items-center">
            <MessageSquare size={32} color="#475569" />
            <Text className="text-slate-500 font-bold text-center text-xs mt-3 uppercase leading-relaxed">
              Secure Link Established.{"\n"}Contact the customer regarding their order.
            </Text>
          </View>
        ) : (
          visibleMessages.map((m, i) => {
            // Anything not sent by the customer is ours — including the document
            // request CustomerIdCard posts, which carries no senderRole.
            const isMe = m.senderRole !== 'customer';
            return (
              <View key={m.id || i} className={`flex-row ${isMe ? 'justify-end' : 'justify-start'} mb-4`}>
                <View
                  style={m.pending ? { opacity: 0.6 } : undefined}
                  className={`max-w-[85%] p-3 rounded-2xl border-2 border-black shadow-brutalist ${
                  isMe ? 'bg-indigo-600 rounded-tr-none' : 'bg-white rounded-tl-none'
                }`}>
                  <Text className={`text-[11px] font-bold leading-relaxed ${isMe ? 'text-white' : 'text-black'}`}>
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

      <View className="p-4 bg-slate-900 border-t-4 border-black flex-row items-center gap-3">
        <TextInput
          value={inputText}
          onChangeText={setInputText}
          placeholder="Send message to customer..."
          placeholderTextColor="#475569"
          className="flex-1 bg-slate-950 border-2 border-black rounded-2xl px-4 py-3 text-xs font-bold text-white focus:bg-slate-800"
        />
        <TouchableOpacity 
          onPress={handleSendMessage}
          disabled={!inputText.trim()}
          className={`w-12 h-12 rounded-2xl items-center justify-center border-2 border-black shadow-brutalist ${
            inputText.trim() ? 'bg-brand-green' : 'bg-slate-100'
          }`}
        >
          <Send size={18} color={inputText.trim() ? "white" : "#94a3b8"} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}