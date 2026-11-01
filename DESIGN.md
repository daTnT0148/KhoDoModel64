# DESIGN SYSTEM & GUIDELINES — MÔ HÌNH 64
*Inspired by Impeccable Design Heuristics*

## 1. Visual DNA & Aesthetic
- **Metaphor:** High-Performance Automotive Cockpit / Modern Trading Terminal.
- **Atmosphere:** Deep obsidian dark mode (`#0b0f19` to `#0f1524`) paired with purposeful neon accents (Indigo, Emerald, Tangerine, Ruby).
- **Surface Elevation:** Subtle glassmorphism (`rgba(21, 29, 51, 0.7)` backdrop-filter blur) with delicate 1px border glows (`rgba(255, 255, 255, 0.06)`).

---

## 2. Design Tokens

### Colors & Semantic Roles
| Token | Value | Role |
| :--- | :--- | :--- |
| `--bg-color` | `#0b0f19` | Deepest root background |
| `--bg-main` | `#0f1524` | Main content container |
| `--sidebar-bg` | `#090c14` | Sidebar navigation background |
| `--card-bg` | `rgba(21, 29, 51, 0.7)` | Standard elevated cards & panels |
| `--primary` | `#6366f1` | Primary action buttons, active navigation, active tabs |
| `--green` | `#10b981` | Realized profit, positive cash flow, delivered packages |
| `--orange` | `#f97316` | Revenue, in-transit status, warnings |
| `--danger` | `#ef4444` | Expenses, net losses, failed deliveries, cancellations |
| `--text-main` | `#f3f4f6` | High-contrast body text & titles |
| `--text-muted` | `#9ca3af` | Secondary labels, timestamps, metadata |
| `--text-dark` | `#4b5563` | Subdued borders, inactive icons |

### Typography
- **Font Family:** `'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- **Scale:**
  - KPI Hero Numbers: `26px - 32px` | Weight: `700` or `800`
  - Section Headings: `18px - 20px` | Weight: `600`
  - Card Titles & Labels: `12px - 14px` | Weight: `500` / `600`
  - Data / Table Cells: `13px - 14px` | Tabular numbers
  - Subtext & Badges: `10px - 11px` | Weight: `600` / `uppercase`

### Geometry & Spacing
- **Border Radii:**
  - Badges / Small Buttons: `8px` (`--border-radius-sm`)
  - Cards / Inputs: `12px` (`--border-radius-md`)
  - Modals / Large Hero Cards: `16px - 18px` (`--border-radius-lg`)
- **Transitions:** `all 0.25s cubic-bezier(0.4, 0, 0.2, 1)`

---

## 3. Anti-Patterns ("Anti-AI Slop" Directives)
*Strictly prohibited in all future UI code:*

1. **NO Low-Contrast Gray-on-Dark:**
   - Never use text colors below `#9ca3af` for readable information. Text must pass WCAG AA contrast (minimum 4.5:1).
2. **NO Redundant Card Nesting:**
   - Avoid generic `card > card > card` stacking. Use layout dividers, subtle background shading, or grid columns instead of wrapping everything in a bordered box.
3. **NO Generic Button Styling:**
   - Every button must have clear visual hierarchy: Primary (`--primary` glow), Secondary (ghost with border), or Destructive (`--danger`).
4. **NO Raw Unformatted Numbers:**
   - Financial numbers must ALWAYS pass through `formatCurrency()` with currency symbol.
   - Numbers in tables must be right-aligned (`text-align: right`) for easy visual scanning.
5. **NO Fragile Mobile Layouts:**
   - Every input and clickable action must have a touch target of at least `44px × 44px`.
   - Never let tables cause horizontal overflow on mobile without an explicit card-view toggle or touch scroll wrapper.

---

## 4. UI Audit Checklist
Before declaring any UI task complete:
- [ ] Visual hierarchy is obvious within 3 seconds of viewing.
- [ ] Primary numbers/KPIs are prominent and formatted with currency.
- [ ] Dark theme contrast passes inspection (no muddy gray-on-dark text).
- [ ] Hover, active, and focus states are smooth and responsive.
- [ ] Mobile view (<= 768px) is fully tested with bottom nav and card layouts.
