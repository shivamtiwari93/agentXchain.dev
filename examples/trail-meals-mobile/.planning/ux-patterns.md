# UX Patterns

## Navigation Pattern

- **Stack navigator** for the main flow: Trips → Trip Detail → Meal Editor
- **Bottom tab navigator** inside Trip Detail: Days tab + Summary tab
- **React Navigation 7** with native stack for smooth transitions
- **Dark theme** throughout (`#0f0f23` background, `#1a1a2e` cards, `#e0e0e0` text, `#4CAF50` accent)

## Gesture Behavior

- **Long-press to delete** trips (with confirmation alert)
- **Tap to navigate** forward through the stack
- **Swipe back** via native stack navigator (iOS) or hardware back button (Android)
- **Long-press to remove** ingredients from a meal

## Safe Areas and Platform Adaptation

- All screens wrapped in `SafeAreaView` to respect notch, status bar, and home indicator
- `KeyboardAvoidingView` with platform-specific behavior (`padding` on iOS, default on Android)
- `StatusBar` set to `light-content` with dark background across platforms
- Bottom tab bar styled with dark background to match the app theme
- Input fields use `placeholderTextColor` for visibility on dark backgrounds
