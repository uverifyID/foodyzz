import React, { useEffect, useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Sparkles, Calendar, User, MessageCircle, X } from 'lucide-react-native';
import authNative from '@react-native-firebase/auth';

import { db } from '../services/firebase';
import HomeScreen from '../screens/HomeScreen';
import OrdersScreen from '../screens/OrdersScreen';
import ProfileScreen from '../screens/ProfileScreen';
import OrderWizard from '../screens/OrderWizard';
import ChatScreen from '../screens/ChatScreen';
import { useUserProfile } from '../context/UserProfileContext';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// True when FoodyzzHQ has sent a reply the customer hasn't seen yet. Computed client-side
// (no function needed): compare the latest incoming supportMessages entry against the
// `supportLastReadAt` stamp the Chat screen writes whenever it's open. The
// supportLastReadAt value is read from the shared profile listener (UserProfileContext)
// instead of a duplicate users/{phone} onSnapshot; only the supportMessages listener
// (a different collection) stays local here.
function useHqChatUnread(): boolean {
  const { profile } = useUserProfile();
  const [latestHqAt, setLatestHqAt] = useState(0);
  useEffect(() => {
    const phone = authNative().currentUser?.phoneNumber;
    if (!phone) return;
    // Latest message NOT sent by the customer = latest FoodyzzHQ (admin/bot) reply.
    const unsubMsg = db
      .collection('supportMessages')
      .where('userPhone', '==', phone)
      .orderBy('timestamp', 'desc')
      .limit(10)
      .onSnapshot((snap) => {
        const docs = snap?.docs?.map((d) => d.data() as any) || [];
        const latestHq = docs.find((m) => m?.senderPhone && m.senderPhone !== phone);
        setLatestHqAt(latestHq?.timestamp ? Date.parse(latestHq.timestamp) || 0 : 0);
      });
    return () => { unsubMsg(); };
  }, []);
  const lastReadAt = profile?.supportLastReadAt ? Date.parse(profile.supportLastReadAt) || 0 : 0;
  return latestHqAt > 0 && latestHqAt > lastReadAt;
}

function MainTabs() {
  const hqUnread = useHqChatUnread();
  return (
    <Tab.Navigator screenOptions={{
      tabBarStyle: { height: 70, borderTopWidth: 2, borderTopColor: '#e2e8f0' },
      tabBarActiveTintColor: '#507425',
      tabBarLabelStyle: { fontSize: 10, fontWeight: 'bold', marginBottom: 10 }
    }}>
      <Tab.Screen name="Explore" component={HomeScreen} options={{
        tabBarIcon: ({ color }) => <Sparkles size={20} color={color} />
      }} />
      <Tab.Screen name="My Rentals" component={OrdersScreen} options={{
        tabBarIcon: ({ color }) => <Calendar size={20} color={color} />
      }} />
      {/* Same ChatScreen as the order thread — no orderId param means the global
          FoodyzzHQ conversation. One design, two entry points. */}
      <Tab.Screen name="Chat" component={ChatScreen} options={{
        tabBarIcon: ({ color }) => (
          <View>
            <MessageCircle size={20} color={color} />
            {hqUnread && (
              <View style={{
                position: 'absolute', top: -2, right: -4,
                width: 9, height: 9, borderRadius: 5,
                backgroundColor: '#ef4444', borderWidth: 1.5, borderColor: '#ffffff',
              }} />
            )}
          </View>
        ),
      }} />
      <Tab.Screen name="Account" component={ProfileScreen} options={{
        tabBarIcon: ({ color }) => <User size={20} color={color} />
      }} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main" component={MainTabs} />
      <Stack.Screen
        name="Wizard"
        component={OrderWizard}
        options={({ navigation }) => ({
          presentation: 'modal',
          headerShown: true,
          title: 'Ride Now',
          headerStyle: { backgroundColor: 'white' },
          headerShadowVisible: false,
          headerRight: () => (
            <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 8 }}>
              <X size={22} color="black" />
            </TouchableOpacity>
          ),
        })}
      />
      {/* Both of these are the SAME screen as the Chat tab. `Support` is the Account
          entry point to the global FoodyzzHQ conversation; `OrderChat` carries an
          `orderId` param and threads that order (the `messages` collection). The
          customer sees one chat design either way — only FoodyzzHQ sees the split. */}
      <Stack.Screen name="Support" component={ChatScreen} />
      <Stack.Screen name="OrderChat" component={ChatScreen} />
    </Stack.Navigator>
  );
}