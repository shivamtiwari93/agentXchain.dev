import React from 'react';
import { View, Text, FlatList, SafeAreaView, StyleSheet } from 'react-native';

const DEFAULT_CALORIE_FLOOR = 2000;

export default function SummaryScreen({ route }) {
  const { trip } = route.params || {};
  if (!trip) return <Text style={styles.empty}>No trip selected</Text>;

  const perDay = trip.dayPlans.map((day) => {
    const cal = day.meals.reduce((s, m) => s + (m.totalCalories || 0), 0);
    const wt = day.meals.reduce((s, m) => s + (m.totalWeightG || 0), 0);
    const empty = day.meals.filter((m) => m.isEmpty).length;
    return { dayIndex: day.dayIndex, calories: cal, weightG: wt, emptyMeals: empty };
  });

  const totalCal = perDay.reduce((s, d) => s + d.calories, 0);
  const totalWt = perDay.reduce((s, d) => s + d.weightG, 0);
  const overBudget = trip.weightBudgetG > 0 && totalWt > trip.weightBudgetG;
  const lowDays = perDay.filter((d) => d.calories < DEFAULT_CALORIE_FLOOR);

  const renderDay = ({ item }) => {
    const isLow = item.calories < DEFAULT_CALORIE_FLOOR;
    return (
      <View style={[styles.dayRow, isLow && styles.dayRowWarn]}>
        <Text style={styles.dayLabel}>Day {item.dayIndex + 1}</Text>
        <Text style={styles.dayStat}>{item.calories} kcal</Text>
        <Text style={styles.dayStat}>{item.weightG}g</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>{trip.name} — Summary</Text>

      <FlatList
        data={perDay}
        keyExtractor={(d) => String(d.dayIndex)}
        renderItem={renderDay}
        contentContainerStyle={styles.list}
      />

      <View style={styles.totalsBox}>
        <Text style={styles.totalLine}>Total: {totalCal} kcal · {totalWt}g</Text>
        {overBudget && (
          <Text style={styles.warn}>⚠ Over weight budget ({totalWt}g / {trip.weightBudgetG}g)</Text>
        )}
        {lowDays.length > 0 && (
          <Text style={styles.warn}>
            ⚠ Low calorie days: {lowDays.map((d) => `Day ${d.dayIndex + 1}`).join(', ')} (below {DEFAULT_CALORIE_FLOOR} kcal)
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f23' },
  title: { color: '#e0e0e0', fontSize: 20, fontWeight: '700', padding: 16 },
  list: { paddingHorizontal: 16 },
  empty: { color: '#888', textAlign: 'center', marginTop: 48 },
  dayRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 12, backgroundColor: '#1a1a2e', borderRadius: 8, marginBottom: 8 },
  dayRowWarn: { borderLeftWidth: 3, borderLeftColor: '#FF9800' },
  dayLabel: { color: '#e0e0e0', fontWeight: '600' },
  dayStat: { color: '#888' },
  totalsBox: { padding: 16, borderTopWidth: 1, borderTopColor: '#333' },
  totalLine: { color: '#4CAF50', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  warn: { color: '#FF9800', textAlign: 'center', marginTop: 8, fontSize: 14 },
});
