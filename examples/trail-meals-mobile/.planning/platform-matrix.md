# Platform Matrix

## iOS

- **Target**: iOS 15+
- **Build**: `npx expo run:ios` or Expo Go app
- **Bundle ID**: `dev.agentxchain.trailmeals`
- **Safe areas**: Handled via `SafeAreaView` from `react-native`
- **Storage**: AsyncStorage maps to NSUserDefaults-backed storage
- **Orientation**: Portrait-locked for hiking ergonomics (one-handed use)

## Android

- **Target**: Android 10+ (API 29+)
- **Build**: `npx expo run:android` or Expo Go app
- **Package**: `dev.agentxchain.trailmeals`
- **Navigation bar**: Dark theme matches app (`backgroundColor: '#0f0f23'`)
- **Storage**: AsyncStorage maps to SQLite-backed storage on Android
- **Back button**: Handled by React Navigation stack navigator

## Expo Go

- **Primary development path**: `npx expo start` → scan QR with Expo Go app
- **No native build tools required** for development and testing
- **Limitations**: No custom native modules. All dependencies are Expo-compatible.
- **OTA updates**: Expo's update system for quick iteration without app store review

## Testing Without Device

- Core business logic (model, planner, storage) is pure Node.js — tested via `node --test`
- React Native screen code requires a device/emulator for visual testing
- CI runs only the pure-logic tests; visual testing is a manual QA activity
