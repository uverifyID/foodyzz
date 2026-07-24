import { View, Text, TouchableOpacity } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

export const PromoBanner = ({ userName, onStart }: { userName: string, onStart: () => void }) => (
  <View className="bg-indigo-600 p-4 rounded-3xl shadow-md relative overflow-hidden">
    <View className="opacity-10 absolute -bottom-8 -right-8 w-28 h-28 bg-white rounded-full" />

    <Text className="text-[9px] uppercase font-bold text-indigo-100 tracking-wider">
      Welcome Back, {userName}!
    </Text>

    <Text className="text-lg font-extrabold text-white tracking-tight mt-0.5">
      Need a bike for deliveries?
    </Text>

    <TouchableOpacity
      onPress={onStart}
      className="bg-white mt-4 flex-row items-center justify-center px-4 py-3 rounded-xl shadow-sm"
    >
      <Text className="text-indigo-700 font-extrabold text-xs mr-2">Ride Now</Text>
      <ChevronRight size={13} color="#507425" />
    </TouchableOpacity>
  </View>
);
