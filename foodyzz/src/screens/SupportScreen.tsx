import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { ArrowLeft, Send, MessageSquare } from 'lucide-react-native';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../services/firebase';
import authNative from '@react-native-firebase/auth';
import { onSnapshot, collection, query, where, orderBy, limit, addDoc } from '@react-native-firebase/firestore';
import { COLORS } from '../theme';
import { SupportMessage, AppRole } from '../types';
import { useUserProfile } from '../context/UserProfileContext';

export default function SupportScreen() {
    const navigation = useNavigation();
    const isFocused = useIsFocused();
    const insets = useSafeAreaInsets();
    const headerHeight = useHeaderHeight();
    const user = authNative().currentUser;
    const [supportInputText, setSupportInputText] = useState('');
    const [supportMessages, setSupportMessages] = useState<SupportMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const scrollViewRef = useRef<ScrollView>(null);

    // User profile (name/role for outgoing messages) comes from the shared single
    // listener (UserProfileContext) instead of a duplicate users/{phone} onSnapshot.
    const { profile: currentUserProfile } = useUserProfile();

    useLayoutEffect(() => {
        navigation.setOptions({
            headerShown: true,
            headerTitle: () => (
                <View className="flex-row items-center gap-2.5">
                    <View className="w-8 h-8 rounded-full bg-[#004a3c] items-center justify-center border border-white/20">
                        <Text className="font-bold text-white uppercase text-[11px]">HQ</Text>
                    </View>
                    <View>
                        <Text className="font-extrabold text-xs text-white">FoodyzzHQ</Text>
                        <Text className="text-[8px] text-[#25d366] font-bold uppercase">🟢 Online</Text>
                    </View>
                </View>
            ),
            headerTitleAlign: 'left',
            headerBackVisible: false,
            // As a tab there's nothing to go back to, so only show the arrow when opened
            // from a stack (e.g. the Account → Support entry point).
            headerLeft: navigation.canGoBack()
                ? () => (
                    <TouchableOpacity onPress={() => navigation.goBack()} className="p-1.5 ml-2">
                        <ArrowLeft size={18} color="white" />
                    </TouchableOpacity>
                )
                : undefined,
            headerRight: () => (
                <View className="bg-[#004a3c] px-2 py-0.5 rounded border border-teal-600/45 mr-4">
                    <Text className="text-[8px] font-bold text-white uppercase">Direct chat</Text>
                </View>
            ),
            headerStyle: { backgroundColor: '#005c4b', elevation: 4, shadowOpacity: 0.3 },
            headerTintColor: 'white',
        });
    }, [navigation]);

    useEffect(() => {
        if (!user?.phoneNumber) return;

        // Bound the read: only the 100 most recent messages (DESC + limit), then
        // reverse so display order stays oldest→newest.
        const q = query(
            collection(db, 'supportMessages'),
            where('userPhone', '==', user.phoneNumber),
            orderBy('timestamp', 'desc'),
            limit(100)
        );

        const unsub = onSnapshot(q, (snapshot) => {
                if (!snapshot) return;
                const messages: SupportMessage[] = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                } as SupportMessage)).reverse();
                setSupportMessages(messages);
                setLoading(false);
            }, (error) => {
                console.error("Error fetching support messages:", error);
                setLoading(false);
            });

        return unsub;
    }, [user]);

    useEffect(() => {
        // Scroll to bottom when messages update
        if (scrollViewRef.current) {
            scrollViewRef.current.scrollToEnd({ animated: true });
        }
    }, [supportMessages]);

    // While the chat is open, stamp it read so the Chat tab's unread dot clears.
    // Fires once when the screen gains focus — supportMessages is intentionally NOT
    // a dependency, otherwise it would re-write the doc on every inbound message
    // (write amplification). A reply that lands while the screen is already focused
    // is still covered: the unread dot only shows once the customer leaves and a
    // newer message arrives.
    useEffect(() => {
        if (!isFocused || !user?.phoneNumber) return;
        db.collection('users').doc(user.phoneNumber)
            .set({ supportLastReadAt: new Date().toISOString() }, { merge: true })
            .catch(() => {});
    }, [isFocused, user]);

    const handleSendSupport = async () => {
        if (!supportInputText.trim() || !user?.phoneNumber || !currentUserProfile) return;

        const newMsg: SupportMessage = {
            userPhone: user.phoneNumber,
            userName: currentUserProfile.name || 'Customer',
            userRole: AppRole.CUSTOMER,
            senderPhone: user.phoneNumber,
            senderName: currentUserProfile.name || 'Customer',
            text: supportInputText,
            timestamp: new Date().toISOString(),
            isReadByAdmin: false, // Admin will mark as read
        };

        try {
            await addDoc(collection(db, 'supportMessages'), newMsg);
            setSupportInputText('');
        } catch (error) {
            console.error("Error sending support message:", error);
            Alert.alert("Error", "Could not send message. Please try again.");
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
            className="flex-1 bg-[#efeae2]"
        >

            {/* Messaging Chat feed (WhatsApp wallpaper backdropped) */}
            <ScrollView ref={scrollViewRef} className="flex-1 p-4 space-y-3">
                {supportMessages.length === 0 ? (
                    <View className="bg-white/85 p-4 border border-slate-200 rounded-2xl items-center justify-center mx-auto mt-10 max-w-[270px]">
                        <Text className="text-[10px] font-bold uppercase text-slate-600">🔒 Chat with FoodyzzHQ</Text>
                        <Text className="text-[9px] text-slate-600 mt-1 text-center">FoodyzzHQ will answer any questions shortly. Send a message below.</Text>
                    </View>
                ) : (
                    supportMessages.map((msg, i) => {
                        const isFromMe = msg.senderPhone === user?.phoneNumber;
                        return (
                            <View key={msg.id || i} className={`flex-row ${isFromMe ? 'justify-end' : 'justify-start'}`}>
                                <View className={`max-w-[85%] rounded-xl px-2.5 py-1.5 shadow-sm ${isFromMe ? 'bg-[#d9fdd3] rounded-br-none' : 'bg-white rounded-bl-none border border-slate-100'}`}>
                                    <Text className="text-[8px] font-black text-slate-400 uppercase mb-0.5">{isFromMe ? 'You' : msg.senderName}</Text>
                                    <Text className="text-[11px] font-semibold text-slate-700 pr-6 pb-1.5">{msg.text}</Text>
                                    <Text className="absolute bottom-0.5 right-1.5 text-[7.5px] text-slate-400 font-bold">
                                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                                    </Text>
                                </View>
                            </View>
                        );
                    })
                )}
            </ScrollView>

            {/* Input Panel block */}
            <View
                className="bg-[#f0f2f5] px-2.5 pt-2.5 border-t border-slate-200 flex-row items-center gap-2.5"
                style={{ paddingBottom: insets.bottom + 28 }}
            >
                <TextInput
                    value={supportInputText}
                    onChangeText={setSupportInputText}
                    placeholder="Message FoodyzzHQ..."
                    placeholderTextColor="#64748b"
                    className="flex-1 bg-white border border-slate-200 rounded-full px-4 py-1.5 text-xs text-slate-800 font-semibold"
                />
                <TouchableOpacity onPress={handleSendSupport} className="w-11 h-11 rounded-full bg-[#00a884] items-center justify-center">
                    <Send size={18} color="white" style={{ marginRight: 2 }} />
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
}
