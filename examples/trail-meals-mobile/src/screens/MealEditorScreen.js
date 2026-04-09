import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  SafeAreaView, StyleSheet, Alert,
} from 'react-native';

export default function MealEditorScreen({ route, navigation }) {
  const { dayIndex, mealType } = route.params || {};
  const [mealName, setMealName] = useState('');
  const [ingredients, setIngredients] = useState([]);
  const [ingName, setIngName] = useState('');
  const [ingCal, setIngCal] = useState('');
  const [ingWeight, setIngWeight] = useState('');

  const addIngredient = () => {
    const cal = parseFloat(ingCal);
    const wt = parseFloat(ingWeight);
    if (!ingName.trim()) return Alert.alert('Error', 'Ingredient name required');
    if (isNaN(cal) || cal < 0) return Alert.alert('Error', 'Calories must be non-negative');
    if (isNaN(wt) || wt < 0) return Alert.alert('Error', 'Weight must be non-negative');

    setIngredients((prev) => [
      ...prev,
      { name: ingName.trim(), caloriesPer100g: cal, weightG: wt, calories: Math.round((cal * wt) / 100) },
    ]);
    setIngName('');
    setIngCal('');
    setIngWeight('');
  };

  const removeIngredient = (index) => {
    setIngredients((prev) => prev.filter((_, i) => i !== index));
  };

  const totalCal = ingredients.reduce((s, i) => s + i.calories, 0);
  const totalWt = ingredients.reduce((s, i) => s + i.weightG, 0);

  const renderIngredient = ({ item, index }) => (
    <TouchableOpacity onLongPress={() => removeIngredient(index)} style={styles.ingRow}>
      <Text style={styles.ingName}>{item.name}</Text>
      <Text style={styles.ingInfo}>{item.calories} kcal · {item.weightG}g</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>Day {(dayIndex || 0) + 1} — {mealType}</Text>

      <TextInput style={styles.input} placeholder="Meal name" placeholderTextColor="#666" value={mealName} onChangeText={setMealName} />

      <FlatList
        data={ingredients}
        keyExtractor={(_, i) => String(i)}
        renderItem={renderIngredient}
        ListEmptyComponent={<Text style={styles.empty}>No ingredients yet</Text>}
        style={styles.list}
      />

      <View style={styles.totals}>
        <Text style={styles.totalText}>Total: {totalCal} kcal · {totalWt}g</Text>
      </View>

      <View style={styles.addForm}>
        <TextInput style={[styles.input, styles.flex1]} placeholder="Ingredient" placeholderTextColor="#666" value={ingName} onChangeText={setIngName} />
        <TextInput style={[styles.input, styles.small]} placeholder="Cal/100g" placeholderTextColor="#666" keyboardType="numeric" value={ingCal} onChangeText={setIngCal} />
        <TextInput style={[styles.input, styles.small]} placeholder="Wt (g)" placeholderTextColor="#666" keyboardType="numeric" value={ingWeight} onChangeText={setIngWeight} />
        <TouchableOpacity style={styles.addBtn} onPress={addIngredient}>
          <Text style={styles.addBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f23', padding: 16 },
  header: { color: '#4CAF50', fontSize: 18, fontWeight: '700', marginBottom: 12, textTransform: 'capitalize' },
  input: { backgroundColor: '#1a1a2e', color: '#e0e0e0', padding: 10, borderRadius: 8, marginBottom: 8 },
  list: { flex: 1 },
  empty: { color: '#888', textAlign: 'center', marginTop: 24 },
  ingRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#222' },
  ingName: { color: '#e0e0e0' },
  ingInfo: { color: '#888' },
  totals: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#333' },
  totalText: { color: '#4CAF50', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  addForm: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flex1: { flex: 1 },
  small: { width: 70 },
  addBtn: { backgroundColor: '#4CAF50', width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  addBtnText: { color: '#fff', fontSize: 20, fontWeight: '700' },
});
