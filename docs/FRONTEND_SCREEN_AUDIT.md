# Frontend screen audit

Inventory of every user-facing screen and significant UI surface in the
ParkFlow app, with its design condition and how far it was verified during
the visual-consistency passes (2026-10-26).

Discovered from the Expo Router tree (`app/**`, excluding the 13 `_layout.tsx`
files and the `app/index.tsx` redirect), from every component that renders a
`BottomSheet`, and from the map's floating panels. Screens were rendered in the
web build at 390 px (plus 320 px and 1440 px for the tab shell), signed in with
the development quick-login account (`demo@parkflow.ps`).

**Coverage: 35 of 52 screens rendered and inspected; 17 not openable** with the
local data and account (reasons listed per row). 16 of 31 sheets and panels
rendered.

## Legend

| Mark | Meaning |
|---|---|
| ✅ | Done and checked in the rendered app |
| 🔧 | Changed in code, but not rendered (screen not reachable) |
| — | Not applicable |
| ⛔ | Not done — see the reason column |

Condition before this pass: **P** already polished · **PR** partially
redesigned · **NR** not redesigned · **VI** visually inconsistent · **NA** not
yet accessible for inspection.

## Screens (52)

| Screen | Route | Section · access | Auth | Condition | Inspected | Redesign | Mobile | AR / EN | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Welcome | `/(onboarding)/welcome` | Entry | No | P | ✅ | ✅ | ✅ | ✅ / ✅ | Feature list rebuilt as an itinerary (earlier pass). |
| Email | `/(onboarding)/email` | Sign-up step 1 | No | P | ✅ | ✅ | ✅ | ✅ / — | Focus outline fixed (earlier pass). |
| OTP | `/(onboarding)/otp` | Sign-up step 2 | No | P | ✅ | Verified unnecessary | ✅ | ✅ / — | |
| Name | `/(onboarding)/name` | Sign-up step 3 | No | P | ✅ | Verified unnecessary | ✅ | ✅ / — | |
| Vehicle | `/(onboarding)/vehicle` | Sign-up step 4 | No | P | ✅ | Verified unnecessary | ✅ | ✅ / — | |
| Map | `/(tabs)/map` | Tab | Yes | P | ✅ | ✅ | ✅ | ✅ / ✅ | |
| Share (rides & spots) | `/(tabs)/share` | Tab | Yes | P | ✅ | ✅ | ✅ | ✅ / ✅ | |
| Activity | `/(tabs)/activity` | Tab | Yes | P | ✅ | ✅ | ✅ | ✅ / ✅ | |
| Vehicles | `/(tabs)/vehicles` | Tab | Yes | P | ✅ | ✅ | ✅ | ✅ / ✅ | |
| Wallet | `/(tabs)/wallet` | Tab | Yes | P | ✅ | ✅ | ✅ | ✅ / ✅ | |
| Profile | `/(tabs)/profile` | Tab | Yes | P | ✅ | ✅ | ✅ | ✅ / ✅ | |
| Not found | `+not-found` | Any unknown URL | No | P | ✅ | Verified unnecessary | ✅ | ✅ / — | |
| Notifications | `/notifications` | Map bell, Profile | Yes | P | ✅ | ✅ | ✅ | ✅ / — | |
| Road alerts | `/roads` | Map rail, Profile | Yes | P | ✅ | ✅ | ✅ | ✅ / — | |
| Scan QR | `/scan` | Map rail → Scan | Yes | **VI** | ✅ | ✅ | ✅ | ✅ / ✅ | Hint row hard-coded `'row'`: icon on the wrong edge in Arabic. |
| Parking layout | `/parking/layout/[zoneId]` | Zone sheet → View parking map | Yes | **NR** | ✅ | ✅ | ✅ | ✅ / — | Solid-green spot wall → soft status tints, one solid selected spot, matching legend. |
| Reserve spot | `/parking/reserve/[zoneId]` | Layout → Choose / Zone sheet → Reserve | Yes | **VI** | ✅ | ✅ | ✅ | ✅ / ✅ | Own copy of the old boxed stepper; now the shared one. |
| Start parking | `/parking/start` | Zone sheet → Start parking | Yes | P | ✅ | Verified unnecessary | ✅ | ✅ / — | |
| My reservations | `/parking/reservations` | Profile | Yes | **VI** | ✅ | ✅ | ✅ | ✅ / — | Loose pills tabs → inset track like its peers. |
| Personal info | `/profile/personal` | Profile | Yes | P | ✅ | ✅ | ✅ | ✅ / — | Disabled Save now looks disabled (earlier pass). |
| Points | `/profile/points` | Profile | Yes | P | ✅ | ✅ | ✅ | ✅ / — | |
| Settings | `/profile/settings` | Profile | Yes | P | ✅ | ✅ | ✅ | ✅ / ✅ | |
| Help | `/profile/help` | Profile | Yes | **VI** | ✅ | ✅ | ✅ | ✅ / — | Detached decorative FAQ icon removed; question weight balanced. |
| About | `/profile/about` | Profile | Yes | P | ✅ | Verified unnecessary | ✅ | ✅ / — | |
| My rides | `/rides/mine` | Share → My rides | Yes | P | ✅ | Verified unnecessary | ✅ | ✅ / — | |
| Offer a ride | `/rides/new` | Share → Offer | Yes | **VI** | ✅ | ✅ | ✅ | ✅ / — | Boxed − / + steppers → one recessed stepper. |
| My spots | `/spots/mine` | Share → My spots | Yes | P | ✅ | Verified unnecessary | ✅ | ✅ / — | |
| List a spot | `/spots/new` | Share → List | Yes | **VI** | ✅ | ✅ | ✅ | ✅ / — | City field was grey-filled unlike every other input; steppers. |
| Add vehicle | `/vehicles/add` | Vehicles, Map selector | Yes | P | ✅ | Verified unnecessary | ✅ | ✅ / — | |
| Warning-light check | `/vehicles/warning-check` | Vehicles header, car-service panel | Yes | P | ✅ | Verified unnecessary | ✅ | ✅ / — | |
| Violations | `/violations` | Profile | Yes | P | ✅ | Verified unnecessary | ✅ | ✅ / — | |
| Gate pass | `/gate/pass` | Profile | Yes | P | ✅ | Verified unnecessary | ✅ | ✅ / — | |
| Payment methods | `/wallet/methods` | Wallet, Profile | Yes | P | ✅ | Verified unnecessary | ✅ | ✅ / — | |
| Add card | `/wallet/add-card` | Wallet → Add card | Yes | P | ✅ | Verified unnecessary | ✅ | ✅ / — | |
| Top up | `/wallet/topup` | Wallet | Yes | P | ✅ | ✅ | ✅ | ✅ / — | |
| Activity detail | `/activity/[id]` | Activity → row | Yes | NA | ⛔ | Shared components only | ⛔ | ⛔ | No transactions on the demo account. |
| Active parking | `/parking/active/[id]` | After starting a session | Yes | NA | ⛔ | Shared components only | ⛔ | ⛔ | Needs a live session (vehicle + balance). |
| Receipt | `/parking/receipt/[id]` | After ending a session | Yes | NA | ⛔ | Shared components only | ⛔ | ⛔ | Needs a finished session. |
| Reservation detail | `/parking/reservation/[id]` | Reservations → row | Yes | NA | ⛔ | Shared components only | ⛔ | ⛔ | No reservations; creating one was not done. |
| Ride detail | `/rides/[id]` | Share → ride card | Yes | NA | ⛔ | 🔧 stepper | ⛔ | ⛔ | No rides in local data. |
| Spot detail | `/spots/[id]` | Share → spot card | Yes | NA | ⛔ | 🔧 RTL chip row, stepper | ⛔ | ⛔ | No spots in local data. |
| Vehicle detail | `/vehicles/[id]` | Vehicles → card | Yes | NA | ⛔ | Shared components only | ⛔ | ⛔ | Demo account has no vehicle. |
| Violation detail | `/violations/[id]` | Violations → row | Yes | NA | ⛔ | Shared components only | ⛔ | ⛔ | No violations. |
| Appeal | `/violations/appeal/[id]` | Violation detail | Yes | NA | ⛔ | Shared components only | ⛔ | ⛔ | No violations. |
| Evidence | `/violations/evidence/[id]` | Violation detail | Yes | NA | ⛔ | Shared components only | ⛔ | ⛔ | No violations. |
| Gate mode | `/gate` | Profile (gate staff) | Staff | NA | ⛔ | Shared components only | ⛔ | ⛔ | Role-gated; demo account is not staff. |
| Patrol check | `/gate/patrol` | Profile (patrol staff) | Staff | NA | ⛔ | Shared components only | ⛔ | ⛔ | Role-gated. |
| Management | `/management` | Profile (admin/operator) | Admin | NA | ⛔ | Shared components only | ⛔ | ⛔ | Role-gated. |
| Management · analytics | `/management/analytics` | Management | Admin | NA | ⛔ | Shared components only | ⛔ | ⛔ | Role-gated. |
| Management · smart gate | `/management/smartgate` | Management | Admin | NA | ⛔ | Shared components only | ⛔ | ⛔ | Role-gated. |
| Management · staff | `/management/staff` | Management | Admin | NA | ⛔ | Shared components only | ⛔ | ⛔ | Role-gated. |
| Management · zones | `/management/zones` | Management | Admin | NA | ⛔ | Shared components only | ⛔ | ⛔ | Role-gated. |

"Shared components only" means the screen picks up the design-system changes
(type scale, radii, buttons, steppers, disabled states, notices) through the
components it uses, but its own composition was not reviewed on screen.

## Sheets, panels and overlays (31)

| Surface | Component | Opened from | Condition | Inspected | Redesign | Notes |
|---|---|---|---|---|---|---|
| Intro sequence | `brand/IntroSequence` | App launch | P | ✅ | Verified unnecessary | |
| Tab bar | `navigation/TabBar` | All tabs | P | ✅ | ✅ | Compact labels < 360 px (earlier pass). |
| Map top bar & search | `map/MapTopBar`, `DestinationSearchBox` | Map | P | ✅ | ✅ | |
| Control rail & entry menu | `map/MapControlRail` | Map | P | ✅ | Verified unnecessary | |
| Nearby parking panel | `map/NearbyParkingPanel` | Map | P | ✅ | ✅ | Error state now aligns to reading start. |
| Zone sheet | `domain/ZoneSheet` | Map marker / nearby row | P | ✅ | ✅ | |
| Route panel | `map/CompactRoutePanel` | Zone sheet → Route | P | ✅ | ✅ | |
| Navigation overlay | `map/navigation/NavigationOverlay` | Route → Start trip | P | ✅ | ✅ | |
| Navigation steps sheet | `NavigationOverlay` › `StepsSheet` | Nav → Steps | NA | ⛔ | Shared components only | Not opened. |
| Destination parking panel | `map/DestinationParkingPanel` | Search → destination | P | ⛔ | 🔧 gutter (earlier pass) | Not rendered. |
| Layers sheet | `map/MapLayersSheet` | Map rail | **VI** | ✅ | ✅ | Sub-category filters were full buttons; now filter chips. |
| Vehicle selector | `domain/VehicleSelectorSheet` | Map top bar | P | ✅ | Verified unnecessary | |
| Zone code sheet | `domain/ZoneCodeSheet` | Map rail → Enter code | **VI** | ✅ | ✅ | QR row hard-coded `'row'` (wrong edge in Arabic). |
| Road report – create | `map/RoadReportCreationSheet` | Map → Report | P | ✅ | Verified unnecessary | Type step inspected. |
| Road report – details | `map/RoadReportDetailsSheet` | Report marker | **VI** | ⛔ | 🔧 | Two hard-coded `'row'`s fixed; sheet not opened. |
| EV status panel | `map/EvMapStatus` | Layers → EV | **NR** | ✅ | ✅ | Now on the shared `MapStatusPanel`. |
| EV filters sheet | `map/EvFiltersSheet` | EV panel → Filters | NA | ⛔ | Shared components only | Not opened. |
| EV station details | `map/EvStationDetailsSheet` | EV marker | **NR** | ⛔ | 🔧 | Shared `PlaceDetails`; no stations in local data. |
| Car-service status panel | `map/CarServiceMapStatus` | Layers → Car services | **NR** | ✅ | ✅ | |
| Car-service details | `map/CarServiceDetailsSheet` | Service marker | **NR** | ✅ | ✅ | Label/value wall → one tray, caveat, action block. |
| Tourism status panel | `map/TourismPlaceMapStatus` | Layers → Tourism | **NR** | ⛔ | 🔧 | Same shell as car services; not rendered. |
| Tourism details | `map/TourismPlaceDetailsSheet` | Place marker | **NR** | ⛔ | 🔧 | Same `PlaceDetails` as car services; not opened. |
| City picker sheet | `domain/CityPicker` › `CitySheet` | Share filters, List a spot | P | ⛔ | 🔧 field only | Field restyled; sheet not opened. |
| Sign-out confirmation | `(tabs)/profile` | Profile → Sign out | P | ✅ | Verified unnecessary | |
| Payment-method actions | `wallet/methods` | Card row | NA | ⛔ | Shared components only | No saved cards. |
| Top-up sheets | `wallet/topup` | Top up | NA | ⛔ | Shared components only | Not opened. |
| Active-session sheets | `parking/active/[id]` | Active parking | NA | ⛔ | Shared components only | No session. |
| Vehicle detail sheets | `vehicles/[id]` | Vehicle detail | NA | ⛔ | Shared components only | No vehicle. |
| Violation sheets | `violations/[id]` | Violation detail | NA | ⛔ | Shared components only | No violations. |
| Management sheets | `management/*` | Admin screens | NA | ⛔ | Shared components only | Role-gated. |
| Crash countdown | `navigation/CrashCountdown` | Crash detection | NA | ⛔ | Shared components only | Requires a detected crash. |

## How to reach the blocked screens

Most blocked rows need data, not code. The project's own seed
(`server/prisma/seed.ts`) gives the demo account a vehicle, ₪200 credit and the
ADMIN role, and creates demo spots. Running it against the local database would
open the management, gate, vehicle, session, receipt and spot screens for review.
This pass did not run it, because it writes to the developer's database.
