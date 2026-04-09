# Offline Strategy

## Storage Backend

- **Technology**: `@react-native-async-storage/async-storage`
- **Why**: Expo-compatible, no native setup, works on iOS (NSUserDefaults) and Android (SQLite)
- **Alternative considered**: `expo-sqlite` — rejected because trip data is small and document-shaped, not relational

## Data Shape

All trip data is stored as a single JSON array under key `@trail_meals_trips`:

```json
[
  {
    "id": "trip_1_1717200000000",
    "name": "PCT Section A",
    "startDate": "2026-06-01",
    "days": 3,
    "weightBudgetG": 5000,
    "dayPlans": [
      {
        "dayIndex": 0,
        "meals": [
          {
            "name": "Oat Bowl",
            "type": "breakfast",
            "ingredients": [
              { "name": "Oats", "caloriesPer100g": 389, "weightG": 100, "calories": 389 }
            ]
          }
        ]
      }
    ]
  }
]
```

## Offline Guarantees

1. **No network dependency**: The app never makes HTTP requests. All data lives on-device.
2. **Immediate availability**: Data is read from AsyncStorage on app launch — no loading spinner waiting on a server.
3. **Persistence across sessions**: Closing and reopening the app retains all trips and meals.
4. **Storage limits**: AsyncStorage has a ~6MB limit on Android. A typical hiker with 50 trips uses <100KB. No practical risk.
5. **No sync**: This is a single-device app. Multi-device sync is out of scope for this example.
