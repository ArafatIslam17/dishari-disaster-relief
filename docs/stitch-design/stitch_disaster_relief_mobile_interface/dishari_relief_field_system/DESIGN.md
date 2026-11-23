---
name: Dishari Relief Field System
colors:
  surface: '#f8f9ff'
  surface-dim: '#d7dae3'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f1f3fc'
  surface-container: '#ebeef7'
  surface-container-high: '#e5e8f1'
  surface-container-highest: '#dfe2eb'
  on-surface: '#181c22'
  on-surface-variant: '#43474f'
  inverse-surface: '#2d3137'
  inverse-on-surface: '#eef0f9'
  outline: '#747780'
  outline-variant: '#c4c6d1'
  surface-tint: '#415e94'
  primary: '#002555'
  on-primary: '#ffffff'
  primary-container: '#1b3b6f'
  on-primary-container: '#8aa7e1'
  inverse-primary: '#acc7ff'
  secondary: '#3c6090'
  on-secondary: '#ffffff'
  secondary-container: '#a5c8ff'
  on-secondary-container: '#2f5384'
  tertiary: '#3a2100'
  on-tertiary: '#ffffff'
  tertiary-container: '#573500'
  on-tertiary-container: '#e89500'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#acc7ff'
  on-primary-fixed: '#001a41'
  on-primary-fixed-variant: '#28467b'
  secondary-fixed: '#d4e3ff'
  secondary-fixed-dim: '#a5c8ff'
  on-secondary-fixed: '#001c3a'
  on-secondary-fixed-variant: '#214877'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#f8f9ff'
  on-background: '#181c22'
  surface-variant: '#dfe2eb'
typography:
  display-lg:
    fontFamily: Roboto Flex
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Roboto Flex
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Roboto Flex
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Roboto Flex
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
  title-md:
    fontFamily: Roboto Flex
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Roboto Flex
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Roboto Flex
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  tabular-stat:
    fontFamily: Roboto Flex
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 24px
    letterSpacing: 0.02em
  label-lg:
    fontFamily: Roboto Flex
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Roboto Flex
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.05em
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-tablet: 1.5rem
  gutter-desktop: 2rem
  margin: 1rem
  margin-tablet: 2rem
  margin-desktop: 3rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Brand & Style

This design system delivers an authoritative, high-clarity utility interface engineered for rapid triage, logistical synchronization, and high-stress field coordination across disaster-affected regions in Bangladesh.

The visual direction combines **Mission-Critical Minimalism** with **Tactile Utility**:
- **Clarity Over Ornamentation:** Information hierarchy is immediate and uncompromised. Data points, resource allocations, and GPS-tagged volunteer units must be identifiable under direct sunlight, monsoon glare, or low-light field conditions.
- **Physical Affirmation:** Buttons and interactive cards feature deep tactile weights, prominent touch-targets (minimum 48px), and distinct ambient focus states to reinforce user confidence when logging data offline.
- **Calm Authority & Urgency:** Grounded navy foundations establish operational stability, while signal-grade amber and luminous sky tones highlight critical telemetry, sync readiness, and network-degraded warnings.

## Colors

The palette is tuned specifically for variable outdoor legibility and instantaneous operational state differentiation:

- **Command Navy (`#1B3B6F`):** Anchors core actions, structural headers, active tab bars, and operational navigation. It communicates administrative authority and operational continuity.
- **Beacon Gold (`#F59E0B`):** Reserved strictly for actionable telemetry: pending sync queues, emergency dispatch alerts, SOS signals, priority tags, and dynamic connection alerts.
- **Sky Signal (`#8FB2E8`):** Provides low-friction ambient accents: muted informational pill backdrops, subtle active row states, and icon container fills that avoid visual fatigue.
- **Crisp Daylight (`#F9FAFC`):** The primary canvas background. Maintains glare reduction compared to pure `#FFFFFF` while retaining high contrast against text elements.
- **Radar Slate (`#0D1117`):** The foundational typographic ink and floating dark indicator pill surface, offering uncompromising WCAG AAA contrast ratios across daylight scenarios.

## Typography

The typography system is engineered for dual-script parity between English operational terms and tabular telemetry, and localized Bangla (`Baloo Da 2`) content:

- **Primary Latin/Tabular (`Roboto Flex`):** Utilized for structural headings, metrics, GPS coordinates, timestamps, and English inputs. Set with open counters and robust stroke weight distribution to guarantee scan-speed efficiency.
- **Bengali Locale System (`Baloo Da 2`):** When rendering Bangla text strings, `Baloo Da 2` serves as the primary family across identical typographic scales. It maintains clear conjunct resolution (যুক্তবর্ণ) and generous ascender/descender clearances at small body and badge sizes.
- **Tabular Alignment:** Numbers, inventory counts, and coordinates must strictly enable `font-variant-numeric: tabular-nums` to eliminate jitter during real-time offline-to-online reconciliation counters.

## Layout & Spacing

Field operations require an ergonomic, thumb-driven layout system designed around single-handed mobile PWA usage, scaling outward to tablet field hubs:

- **Mobile Viewports (<640px):** Single-column fluid architecture. Primary actionable items, dispatch submission triggers, and floating sync status pills are pinned to safe ergonomic thumb zones (bottom 30% of viewport). Outer margins sit at `1rem` (16px) to maximize screen real estate.
- **Tablet Hubs (640px - 1024px):** 6-column to 12-column adaptive layout with `1.5rem` gutters. Accommodates dual-pane triage interfaces: volunteer roster on the left panel, operational zone map and incident feeds on the right panel.
- **Desktop Command (>1024px):** Fixed-max canvas container centered at `1280px` width with `2rem` gutters, prioritizing multi-column logistics dashboards.
- **Vertical Spacing Cadence:** Form fields, incident logs, and check-in rows strictly adhere to multiples of 4px/8px, maintaining an open internal flow (`space-md` for standard card padding; `space-lg` for prominent shelter cluster summaries).

## Elevation & Depth

Visual hierarchy does not rely on deep multi-tier layering, which creates visual noise and battery drain on low-end field mobile hardware. Instead, depth is constructed via tactile colored glows and soft structural ambient diffusion:

- **Base Field Layer:** The base canvas sits at `#F9FAFC`. Subtle, low-contrast ambient mesh glows (using 5% opacity of `#8FB2E8`) designate top-level operational sectors without adding card boundaries.
- **Operational Cards & Panels:** Elevated using a diffused ambient shadow: `box-shadow: 0 4px 20px -2px rgba(13, 17, 23, 0.06), 0 2px 6px -1px rgba(13, 17, 23, 0.04)`. Card borders feature a soft border tint of `rgba(27, 59, 111, 0.08)`.
- **Command Action Glow:** Primary tactical buttons use directional light emission: `box-shadow: 0 8px 24px -4px rgba(27, 59, 111, 0.35)`.
- **Alert & Priority Glow:** Urgent emergency elements and high-priority dispatch beacons leverage an amber focal diffusion: `box-shadow: 0 0 16px -2px rgba(245, 158, 11, 0.45)`.
- **Floating Radar Pills:** Status bars informing offline queue health float over canvas boundaries using an inverted dark layer (`#0D1117`) backed with `box-shadow: 0 10px 28px -4px rgba(13, 17, 23, 0.25)`.

## Shapes

The design system establishes a high-radii geometry that balances approachable field ergonomics with rugged, modern app containers:

- **Cards & Data Modules:** Radii adhere strictly to `1.125rem` (18px) to `1.25rem` (20px), softening the density of complex medical supply tables and shelter rosters.
- **Buttons & Tactical Badges:** Interactive buttons, operational tags, triage indicators, and offline sync notifications use full pill profiles (`rounded-full` / `9999px`), ensuring clear separation between structural card containers and clickable touchpoints.
- **Input Fields:** Form controls, quantity incrementors, and coordinate search bars use matching rounded corners (`12px` to `16px`) for clean thumb interaction.

## Components

### Buttons & CTAs
- **Primary Operational Button:** Fully pill-shaped (`9999px`), background in Command Navy (`#1B3B6F`), high-contrast white text (`#FFFFFF`), with an elevation shadow of `0 8px 24px -4px rgba(27, 59, 111, 0.35)`. Active tap state scales smoothly to `0.98`.
- **Urgent Action Button (SOS / High Priority):** Background in Beacon Gold (`#F59E0B`), Radar Slate typography (`#0D1117`), finished with an alert outer glow.
- **Secondary Ghost Button:** Translucent Sky Signal wash (`rgba(143, 178, 232, 0.15)`), Command Navy text, with a 1.5px border of `rgba(27, 59, 111, 0.2)`.

### Operational Status Badges & Chips
- **Sync Status Chip:** A compact pill button or badge with a 6px pulsing dot. For offline pending queues, the dot glows Beacon Gold (`#F59E0B`) with text `অফলাইন (৩টি পেন্ডিং) / Offline (3 queued)`. When connected and synched, it transitions to a stable emerald state.
- **Filter Chips:** 36px height, rounded-full, with an unselected state using `rgba(27, 59, 111, 0.06)` background and Command Navy text. Selected state inverts directly to solid Command Navy with crisp white text.

### Interactive Incident & Household Cards
- **Structure:** 18px-20px rounded containers wrapped in Daylight surface styling with subtle 1px border `rgba(27, 59, 111, 0.08)`.
- **Icon Anchors:** Leading operational symbols (medical kit, water purification, boat dispatch) are housed inside circular Sky Signal containers (`#8FB2E8` at 25% opacity, or solid `#8FB2E8` for critical markers).
- **Active State:** Tapping or selecting an incident row highlights the item with an ambient background tint of `rgba(143, 178, 232, 0.12)`.

### Offline Sync Notification Pill (Floating)
- **Container:** Floats fixed at bottom-center of viewport. Pill-shaped, background set to Radar Slate (`#0D1117`), typography in high-contrast white and Beacon Gold.
- **Functionality:** Houses a tactile progress arc or queue counter displaying pending IndexedDB transaction buffers awaiting cell network telemetry.

### Input Fields & Controls
- **Form Inputs:** 48px minimum height for field gloved/wet interaction. Background is pure white against the `#F9FAFC` canvas, with an inset border of `1.5px solid rgba(27, 59, 111, 0.16)`. Focus state produces a 2px outer outline in Command Navy with a soft Sky Signal ambient ring.
- **Checkboxes & Radios:** Oversized 22px tap zones, rounded edges for checkboxes (6px), pill radio dots. Filled state renders Command Navy with pure white checkmark icons.