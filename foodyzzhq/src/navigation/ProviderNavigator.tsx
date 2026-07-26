import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Building, BarChart2, Tags, MessageCircle } from 'lucide-react-native';

import DispatchScreen from '../screens/DispatchScreen';
import LogisticsScreen from '../screens/LogisticsScreen';
import PromosScreen from '../screens/PromosScreen';
import AccountScreen from '../screens/AccountScreen';
import ChatScreen from '../screens/ChatScreen';
import HqChatScreen from '../screens/HqChatScreen';
import SupportScreen from '../screens/SupportScreen';
import { db } from '../services/firebase';
import { COLORS } from '../theme';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// Anything waiting in the Chat Center, across BOTH inboxes it now merges:
//   • general threads → supportMessages not yet read by admin and not sent by
//     admin/bot;
//   • order threads   → orders flagged providerUnreadMessage by
//     onCustomerMessageSent, read off the provider-safe mirror.
// Drives the Chat tab red dot.
function useHqChatUnread(): boolean {
  const [supportUnread, setSupportUnread] = useState(false);
  const [orderUnread, setOrderUnread] = useState(false);

  useEffect(() => {
    // Bound this always-on listener: the badge only needs to know whether ANY
    // unread messages exist, so a cap of 50 is plenty (was unbounded for the
    // whole session).
    const unsub = db.collection('supportMessages')
      .where('isReadByAdmin', '==', false)
      .limit(50)
      .onSnapshot((snap) => {
        const docs = snap?.docs?.map((d) => d.data() as any) || [];
        const hasIncoming = docs.some((m) => m?.senderPhone !== 'admin' && m?.senderPhone !== 'system');
        setSupportUnread(hasIncoming);
      }, () => setSupportUnread(false));
    return unsub;
  }, []);

  useEffect(() => {
    // Platform-wide, matching the Chat Center it badges — every FoodyzzHQ user is
    // staff, and a per-store badge would stay dark for a thread the admin can see
    // but happens not to be switched into. Single-field equality, so no composite
    // index; it matches only unread orders, so it usually reads nothing.
    const unsub = db.collection('providerOrders')
      .where('providerUnreadMessage', '==', true)
      .limit(20)
      .onSnapshot((snap) => setOrderUnread((snap?.docs?.length || 0) > 0), () => setOrderUnread(false));
    return unsub;
  }, []);

  return supportUnread || orderUnread;
}

function MainTabs() {
  const hqUnread = useHqChatUnread();
  return (
    <Tab.Navigator screenOptions={{
      headerShown: false,
      tabBarStyle: {
        height: 75,
        backgroundColor: '#020617',
        borderTopWidth: 2,
        borderTopColor: '#1e293b',
        paddingBottom: 12
      },
      tabBarActiveTintColor: COLORS.brand.green,
      tabBarInactiveTintColor: '#475569',
      tabBarLabelStyle: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5 },
    }}>
      <Tab.Screen name="Dispatch" component={DispatchScreen} options={{
        tabBarIcon: ({ color }) => <Building size={20} color={color} />
      }} />
      <Tab.Screen name="Logistics" component={LogisticsScreen} options={{
        tabBarLabel: 'Operations',
        tabBarIcon: ({ color }) => <BarChart2 size={20} color={color} />
      }} />
      <Tab.Screen name="Promos" component={PromosScreen} options={{
        tabBarIcon: ({ color }) => <Tags size={20} color={color} />
      }} />
      <Tab.Screen name="HQChat" component={HqChatScreen} options={{
        tabBarLabel: 'Chat',
        tabBarIcon: ({ color }) => (
          <View>
            <MessageCircle size={20} color={color} />
            {hqUnread && (
              <View style={{
                position: 'absolute', top: -2, right: -4,
                width: 9, height: 9, borderRadius: 5,
                backgroundColor: '#ef4444', borderWidth: 1.5, borderColor: '#020617',
              }} />
            )}
          </View>
        ),
      }} />
    </Tab.Navigator>
  );
}

export default function ProviderNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main" component={MainTabs} />
      {/* Account moved off the footer into the top header (left of the bell);
          reachable everywhere as a stack route. */}
      <Stack.Screen name="Account" component={AccountScreen} />
      {/* Per-order 1:1 chat (order card → this) and the legacy provider↔HQ support thread. */}
      <Stack.Screen name="Chat" component={ChatScreen} />
      <Stack.Screen name="Support" component={SupportScreen} />
    </Stack.Navigator>
  );
}
