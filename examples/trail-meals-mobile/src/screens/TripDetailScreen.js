import React from 'react';
import { View, Text, FlatList, TouchableOpacity, SafeAreaView, StyleSheet } from 'react-native';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

export default function TripDetailScreen({ route, navigation }) {
  const { trip } = route.params || {};
  if (!trip) return <Text style={styles.empty}>No trip selected</Text>;

  const renderDay = ({ item: day }) => (
    <View style={styles.dayCard}>
      <Text style={styles.dayTitle}>Day {day.dayIndex + 1}</Text>
      {MEAL_TYPES.map((type) => {
        const meal = day.meals.find((m) => m.type === type);
        return (
          <TouchableOpacity
            key={type}
            style={styles.mealRow}
            onPress={() => navigation.navigate('MealEditor', { trip, dayIndex: day.dayIndex, mealType: type })}
          >
            <Text style={styles.mealType}>{type}</Text>
            <Text style={styles.mealInfo}>
              {meal ? `${meal.name} · ${meal.totalCalories} kcal` : 'Tap to add'}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={trip.dayPlans}
        keyExtractor={(d) => String(d.dayIndex)}
        renderItem={renderDay}
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f23' },
  list: { padding: 16 },
  empty: { color: '#888', textAlign: 'center', marginTop: 48 },
  dayCard: { backgroundColor: '#1a1a2e', borderRadius: 12, padding: 16, marginBottom: 16 },
  dayTitle: { color: '#4CAF50', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  mealRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#222' },
  mealType: { color: '#e0e0e0', fontWeight: '500', textTransform: 'capitalize' },
  mealInfo: { color: '#888' },
});
