import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';

import TripsScreen from '../screens/TripsScreen';
import TripDetailScreen from '../screens/TripDetailScreen';
import MealEditorScreen from '../screens/MealEditorScreen';
import SummaryScreen from '../screens/SummaryScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function TripTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#4CAF50',
        tabBarInactiveTintColor: '#888',
        tabBarStyle: { backgroundColor: '#1a1a2e' },
      }}
    >
      <Tab.Screen
        name="Days"
        component={TripDetailScreen}
        options={{ tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>📅</Text> }}
      />
      <Tab.Screen
        name="Summary"
        component={SummaryScreen}
        options={{ tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>📊</Text> }}
      />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#1a1a2e' },
          headerTintColor: '#e0e0e0',
          contentStyle: { backgroundColor: '#0f0f23' },
        }}
      >
        <Stack.Screen name="Trips" component={TripsScreen} options={{ title: 'Trail Meals' }} />
        <Stack.Screen name="TripTabs" component={TripTabs} options={{ title: 'Trip Details' }} />
        <Stack.Screen name="MealEditor" component={MealEditorScreen} options={{ title: 'Edit Meal' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
