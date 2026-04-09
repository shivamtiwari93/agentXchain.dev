import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  SafeAreaView, StyleSheet, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';

export default function TripsScreen({ navigation }) {
  const [trips, setTrips] = useState([]);
  const [name, setName] = useState('');
  const [days, setDays] = useState('3');

  const addTrip = useCallback(() => {
    const d = parseInt(days, 10);
    if (!name.trim()) return Alert.alert('Error', 'Trip name is required');
    if (!d || d < 1) return Alert.alert('Error', 'Days must be at least 1');

    const dayPlans = Array.from({ length: d }, (_, i) => ({ dayIndex: i, meals: [] }));
    const trip = {
      id: `trip_${Date.now()}`,
      name: name.trim(),
      startDate: new Date().toISOString().slice(0, 10),
      days: d,
      weightBudgetG: 5000,
      dayPlans,
    };
    setTrips((prev) => [...prev, trip]);
    setName('');
    setDays('3');
  }, [name, days]);

  const deleteTrip = useCallback((id) => {
    Alert.alert('Delete Trip', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => setTrips((prev) => prev.filter((t) => t.id !== id)) },
    ]);
  }, []);

  const renderTrip = ({ item }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate('TripTabs', { trip: item })}
      onLongPress={() => deleteTrip(item.id)}
    >
      <Text style={styles.cardTitle}>{item.name}</Text>
      <Text style={styles.cardSub}>{item.days} days · {item.startDate}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <FlatList
          data={trips}
          keyExtractor={(t) => t.id}
          renderItem={renderTrip}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No trips yet. Plan your first hike!</Text>}
        />
        <View style={styles.form}>
          <TextInput style={styles.input} placeholder="Trip name" placeholderTextColor="#666" value={name} onChangeText={setName} />
          <TextInput style={[styles.input, styles.small]} placeholder="Days" placeholderTextColor="#666" keyboardType="numeric" value={days} onChangeText={setDays} />
          <TouchableOpacity style={styles.addBtn} onPress={addTrip}>
            <Text style={styles.addBtnText}>+ Add</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f23' },
  flex: { flex: 1 },
  list: { padding: 16 },
  empty: { color: '#888', textAlign: 'center', marginTop: 48, fontSize: 16 },
  card: { backgroundColor: '#1a1a2e', padding: 16, borderRadius: 12, marginBottom: 12 },
  cardTitle: { color: '#e0e0e0', fontSize: 18, fontWeight: '600' },
  cardSub: { color: '#888', marginTop: 4 },
  form: { flexDirection: 'row', padding: 12, borderTopWidth: 1, borderTopColor: '#222', alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#1a1a2e', color: '#e0e0e0', padding: 10, borderRadius: 8, marginRight: 8 },
  small: { flex: 0.3 },
  addBtn: { backgroundColor: '#4CAF50', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  addBtnText: { color: '#fff', fontWeight: '600' },
});
