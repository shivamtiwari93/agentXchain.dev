# Trail Meals Mobile — Product Example Spec

## Purpose

Prove AgentXchain can govern the development of a **mobile application** (React Native / Expo) end-to-end. This is the "mobile app" category from the product-examples roadmap.

Trail Meals is a **meal-planning app for hikers and campers** — users plan meals for multi-day trips, tracking calorie targets, weight budgets, and ingredient lists. The domain is inherently mobile: used in the field, needs offline-first storage, and benefits from platform-native UX.

## Why This Domain

- **Offline-first is mandatory**: hikers plan at home, reference in the field with no signal.
- **Weight/calorie math**: real business logic, not just CRUD.
- **Trip-scoped data**: natural entity hierarchy (trip → day → meal → ingredient).
- **Mobile-native UX concerns**: swipe-to-delete, bottom-tab navigation, platform fonts/safe areas.

## Project Structure

```
examples/trail-meals-mobile/
├── agentxchain.json          # Governed config with mobile-specific workflow
├── package.json              # Expo/React Native dependencies
├── TALK.md                   # Governed collaboration log
├── README.md                 # What it is, how to run, how AgentXchain governed it
├── app.json                  # Expo app config
├── App.js                    # Entry point
├── src/
│   ├── model/
│   │   ├── trip.js           # Trip entity: name, startDate, days, weightBudgetG
│   │   ├── meal.js           # Meal entity: name, type (breakfast/lunch/dinner/snack)
│   │   ├── ingredient.js     # Ingredient: name, caloriesPer100g, weightG
│   │   └── planner.js        # Pure business logic: calorie/weight computations
│   ├── storage/
│   │   └── offline-store.js  # AsyncStorage-backed persistence (offline-first)
│   ├── screens/
│   │   ├── TripsScreen.js    # List of trips
│   │   ├── TripDetailScreen.js   # Days and meals for a trip
│   │   ├── MealEditorScreen.js   # Add/edit meal with ingredients
│   │   └── SummaryScreen.js      # Trip nutrition/weight summary
│   └── navigation/
│       └── AppNavigator.js   # React Navigation stack/tab setup
├── test/
│   ├── planner.test.js       # Pure logic tests (node --test compatible)
│   ├── model.test.js         # Entity construction and validation
│   ├── storage.test.js       # Offline store with mock AsyncStorage
│   └── smoke.js              # Quick sanity check
└── .planning/
    ├── ROADMAP.md
    ├── platform-matrix.md    # iOS / Android / Expo Go constraints
    ├── offline-strategy.md   # How offline-first storage works
    ├── ux-patterns.md        # Mobile UX decisions: navigation, gestures, safe areas
    ├── nutrition-model.md    # Calorie/weight computation rules
    ├── API_CONTRACT.md       # Internal data model contract (no HTTP API — local app)
    ├── acceptance-matrix.md
    └── ship-verdict.md
```

## Governance Shape

**6 roles** — meaningfully different from all prior examples:

| Role | Title | Mandate |
|------|-------|---------|
| `pm` | Product Manager | Trip/meal planning scope, user stories, acceptance criteria |
| `mobile_architect` | Mobile Architect | Platform matrix, offline strategy, navigation patterns |
| `rn_engineer` | React Native Engineer | Implement screens, navigation, storage, and platform code |
| `nutrition_analyst` | Nutrition Analyst | Validate calorie/weight formulas, edge cases, unit accuracy |
| `ux_reviewer` | UX Reviewer | Mobile UX patterns, gesture behavior, accessibility |
| `qa` | QA Engineer | End-to-end correctness, offline scenarios, ship verdict |

**5 phases**: `planning → architecture → implementation → ux_review → qa`

This differs from:
- `decision-log-linter`: 3-role dev tool with architecture/release phases
- `habit-board`: 4-role consumer SaaS with designer-in-the-loop
- `async-standup-bot`: 5-role B2B with integration/operations phases

The mobile example adds a **mobile_architect** (platform matrix, offline-first), a **nutrition_analyst** (domain math validation), and a **ux_reviewer** (mobile-specific UX patterns). No prior example has any of these.

## Behavior

### Trip Management
- Create a trip with name, start date, duration (days), and weight budget (grams)
- Each trip has N days, each day has meals (breakfast, lunch, dinner, snack)
- Trips persist locally via AsyncStorage

### Meal Planning
- Add meals to a day with a type and ingredient list
- Each ingredient has: name, calories per 100g, weight in grams
- Meal total = sum of ingredient calories and weights

### Nutrition & Weight Summary
- Per-day calorie total and weight total
- Per-trip calorie total and weight total
- Warning if trip weight exceeds weight budget
- Warning if any day is below a configurable calorie floor (default 2000 kcal for hiking)

### Offline-First
- All data stored locally via AsyncStorage
- No network requests required for core functionality
- App works entirely offline after install

## Error Cases

- Trip with zero or negative days → reject
- Ingredient with negative calories or weight → reject
- Duplicate trip names → allowed (trips identified by generated ID)
- Empty meal (no ingredients) → allowed but flagged in summary
- Weight budget of 0 → treat as "no budget constraint"

## Acceptance Tests

1. `planner.test.js`: Create a trip, add meals with ingredients, verify per-day and per-trip calorie/weight totals are correct
2. `planner.test.js`: Trip weight exceeds budget → warning flag is true
3. `planner.test.js`: Day below calorie floor → warning includes that day's index
4. `model.test.js`: Trip rejects zero days, ingredient rejects negative weight
5. `model.test.js`: Meal type must be one of breakfast/lunch/dinner/snack
6. `storage.test.js`: Save and load a trip via mock AsyncStorage — roundtrip fidelity
7. `storage.test.js`: Load from empty store returns empty array
8. `smoke.js`: Quick end-to-end planner computation returns expected shape

## Mobile Proof Constraints

This example MUST prove it is a real mobile project, not a web app:

1. **`app.json`** — Expo app configuration with iOS/Android platform entries
2. **`package.json`** — Dependencies on `expo`, `react-native`, `@react-navigation/native`, `@react-native-async-storage/async-storage`
3. **`.planning/platform-matrix.md`** — Explicit iOS/Android/Expo Go constraints and test instructions
4. **`.planning/offline-strategy.md`** — AsyncStorage-backed persistence, no network dependency
5. **`.planning/ux-patterns.md`** — Mobile navigation (stack + tabs), safe areas, gesture patterns
6. **React Native screens** — Not HTML/CSS. JSX with `View`, `Text`, `FlatList`, `TouchableOpacity`, `SafeAreaView`
7. **Pure business logic is testable with `node --test`** — No React Native runtime needed for core tests

## Open Questions

None. The scope is clear and bounded.
