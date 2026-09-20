// Customer verification queue — everyone whose identity, proof of address or
// sign-up location is waiting on staff ("Needs review"), and everyone still
// working through it ("In progress"), which is where a location that failed and
// might deserve an override shows up. Tapping a customer opens the full review.
//
// Reads users/{phone}.verification.status, a server-written field; equality on it
// is served by Firestore's automatic single-field index.
import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import { db } from '../services/firebase';
import CustomerVerificationPanel from '../components/CustomerVerificationPanel';

type Filter = 'in_review' | 'action_required';
const LIMIT = 50;

const WAITING_ON: Record<string, string> = {
  identity: 'ID', address: 'address', location: 'location',
};

export default function VerificationsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>('in_review');
  const [rows, setRows] = useState<any[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    return db.collection('users')
      .where('verification.status', '==', filter)
      .limit(LIMIT)
      .onSnapshot(
        (snap) => setRows((snap?.docs ?? [])
          .map((d) => ({ phone: d.id, ...(d.data() as any) }))
          .sort((a, b) => String(b.verification?.updatedAt ?? '').localeCompare(String(a.verification?.updatedAt ?? '')))),
        () => setRows([]),
      );
  }, [filter]);

  const pending = (v: any, want: string) =>
    (['identity', 'address', 'location'] as const).filter((p) => v?.[p] === want).map((p) => WAITING_ON[p]);

  return (
    <View className="flex-1 bg-white">
      <View className="bg-slate-900 px-4 pb-4 border-b-4 border-black" style={{ paddingTop: insets.top + 12 }}>
        <View className="flex-row items-center">
          <TouchableOpacity onPress={() => navigation.goBack()} className="p-1 mr-2"><ChevronLeft size={22} color="#ffffff" /></TouchableOpacity>
          <Text className="text-2xl font-black text-white uppercase tracking-tighter">
            Customer<Text className="text-brand-green">.Verify</Text>
          </Text>
        </View>
        <View className="flex-row mt-4">
          {([['in_review', 'Needs review'], ['action_required', 'In progress']] as const).map(([key, label]) => (
            <TouchableOpacity
              key={key}
              onPress={() => setFilter(key)}
              className={`mr-2 px-3 py-1.5 rounded-xl border-2 ${filter === key ? 'bg-[#86B54F] border-black' : 'bg-slate-950 border-slate-700'}`}
            >
              <Text className={`font-mono font-black text-[10px] uppercase ${filter === key ? 'text-black' : 'text-slate-400'}`}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {rows === null ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color="#507425" /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.phone}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={(
            <Text className="text-center text-xs font-bold text-slate-400 mt-10">
              {filter === 'in_review' ? 'Nothing waiting for review.' : 'Nobody is part-way through verification.'}
            </Text>
          )}
          renderItem={({ item }) => {
            const v = item.verification ?? {};
            const review = pending(v, 'in_review');
            const tooFar = v.location === 'too_far';
            return (
              <TouchableOpacity onPress={() => setOpen(item.phone)} className="border-2 border-black rounded-2xl p-4 mb-3 bg-white flex-row items-center">
                <View className="flex-1">
                  <Text className="text-sm font-black text-black uppercase">{item.name || item.phone}</Text>
                  <Text className="text-[10px] font-mono font-bold text-slate-400">{item.phone}{item.workerId ? ` · ${item.workerId}` : ''}</Text>
                  <Text className="text-[10px] font-bold text-slate-600 mt-1" numberOfLines={1}>{item.address || 'No address'}</Text>
                  <Text className={`text-[10px] font-black uppercase mt-1 ${review.length ? 'text-amber-600' : tooFar ? 'text-red-600' : 'text-slate-500'}`}>
                    {review.length ? `Review: ${review.join(', ')}`
                      : tooFar ? 'Location too far — override?'
                        : `ID ${v.identity ?? '—'} · address ${v.address ?? '—'} · location ${v.location ?? '—'}`.replace(/_/g, ' ')}
                  </Text>
                </View>
                <ChevronRight size={18} color="#94a3b8" />
              </TouchableOpacity>
            );
          }}
        />
      )}

      <Modal visible={!!open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(null)}>
        <View className="flex-1 bg-slate-50">
          <View className="flex-row items-center justify-between px-4 pt-4 pb-3 border-b border-slate-200 bg-white">
            <Text className="text-sm font-black text-black uppercase">{open}</Text>
            <TouchableOpacity onPress={() => setOpen(null)} className="p-1"><X size={22} color="#000000" /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
            {open && <CustomerVerificationPanel phone={open} />}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
