# Design System Specification: The Architectural ERP

## 1. Overview & Creative North Star
### The Creative North Star: "The Precision Architect"
Modern ERP systems often fail by overwhelming the user with "data noise." This design system rejects the cluttered, spreadsheet-heavy aesthetic of legacy software. Instead, it adopts the persona of **"The Precision Architect"**—an editorial-inspired, high-utility framework that treats logistics data with the same elegance as a premium financial journal.

The system breaks away from "template" UI by utilizing **intentional asymmetry, tonal depth over structural lines, and a dramatic typographic scale.** We are not just building a tool for distributors; we are building a high-performance cockpit that radiates trust, authority, and relentless efficiency.

---

## 2. Colors & Surface Philosophy
We move beyond flat hex codes to a system of **Tonal Layering**. The palette is designed to feel "lit from within," using subtle shifts in blue-tinted neutrals to guide the eye without the need for aggressive separators.

### The Palette (Core Tokens)
*   **Primary (`#004ac6`):** Our "Command" color. Use for high-intent actions.
*   **Surface / Background (`#f9f9ff`):** A cool, crisp canvas that prevents eye fatigue.
*   **Success (`#22c55e`):** Stock-levels healthy, payments cleared.
*   **Error (`#ba1a1a`):** Critical stockouts or overdue invoices.

### The "No-Line" Rule
**Explicit Instruction:** Prohibit 1px solid borders for sectioning. Boundaries must be defined solely through background color shifts or tonal transitions.
*   **Action:** Instead of a border, place a `surface_container_lowest` card on a `surface_container_low` background. This creates a "shadow-less" depth that feels sophisticated and modern.

### The Glass & Gradient Rule
To prevent the ERP from feeling like a static document, use **Glassmorphism** for floating elements (modals, mobile navigation docks, or sticky headers).
*   **Token:** `surface` at 80% opacity + 12px Backdrop Blur.
*   **Signature Gradients:** For primary CTAs, use a subtle linear gradient from `primary` to `primary_container`. This adds a "jewel-like" finish that differentiates the UI from generic SaaS kits.

---

## 3. Typography: Editorial Authority
We use **Inter** not just for readability, but as a structural element. By contrasting massive `display` sizes with tight, functional `label` sizes, we create a hierarchy that highlights key performance indicators (KPIs) instantly.

*   **Display (L/M/S):** Used for "Big Data" moments—total revenue, warehouse capacity %. These should feel like headlines in a premium business magazine.
*   **Title (L/M/S):** Used for section headers. Bold and authoritative.
*   **Body (MD):** The 14px workhorse. Set with generous line-height (1.6) to ensure long lists of inventory remain scannable.
*   **Label (MD/SM):** Used for metadata (SKUs, timestamps). Use `on_surface_variant` to keep these legible but secondary.

---

## 4. Elevation & Depth: Tonal Layering
Traditional shadows create "muddy" interfaces. We achieve hierarchy through **Surface Nesting**.

*   **Layering Principle:** 
    1.  **Base Layer:** `surface` (The foundation).
    2.  **Section Layer:** `surface_container_low` (Grouping related modules).
    3.  **Active Component Layer:** `surface_container_lowest` (The "Sheet of Paper" where data is entered).
*   **The Ambient Shadow:** If a floating state is required (e.g., a dropdown), use a shadow tinted with `primary` at 4% opacity: `box-shadow: 0 10px 30px -10px rgba(0, 74, 198, 0.04);`.
*   **The Ghost Border:** If accessibility requires a stroke, use `outline_variant` at 20% opacity. It should be felt, not seen.

---

## 5. Components: High-Performance Primitives
All shadcn/ui primitives must be modified to follow the "Architect" rules.

### Cards & Lists (The Core of ERP)
*   **Rule:** Forbid divider lines. Use vertical whitespace (16px, 24px, or 32px increments) or subtle shifts to `surface_container_high` on hover to separate line items.
*   **Inventory Cards:** Use a `surface_container_lowest` background with a 2px left-accent bar using the status color (`success`, `warning`, `error`).

### Buttons (Tactile Utility)
*   **Primary:** Gradient-filled (`primary` to `primary_container`), `xl` roundedness (0.75rem).
*   **Secondary:** No background, no border. Use `primary` text with a `surface_container` background on hover.
*   **Mobile Note:** All buttons on mobile must have a minimum height of 48px to accommodate field-use environments.

### Input Fields (Contextual Focus)
*   **Default State:** Background `surface_container_low`, no border.
*   **Focus State:** Background `surface_container_lowest`, 2px "Ghost Border" of `primary`, and a subtle `primary` outer glow.
*   **Validation:** Error states should change the background to `error_container` (10% opacity) rather than just turning the text red.

### Signature Component: The "Data Dock"
A floating, glassmorphic bottom bar for mobile devices that houses primary actions (Add Order, Scan SKU). This keeps the thumb-zone clear and ensures the ERP feels "App-like" even in a browser.

---

## 6. Do’s and Don’ts

### Do
*   **Use Asymmetry:** Place a large Display-MD metric in the top left, balanced by a small Label-SM timestamp in the bottom right.
*   **Embrace Negative Space:** If a page feels "empty," it’s working. Data needs room to breathe to be processed accurately.
*   **Use Tonal Transitions:** Use `surface_dim` for "inactive" or "archived" states to visually push them into the background.

### Don’t
*   **Don't use 100% black text:** Use `on_surface` (`#151c27`). It’s softer on the eyes for users spending 8+ hours in the system.
*   **Don't use "Standard" Grids:** Avoid the "3-column equal width" trap. Use a 60/40 or 70/30 split to create an editorial flow.
*   **No Sharp Corners:** Stick strictly to the `md` (0.375rem) and `xl` (0.75rem) roundedness scale. Sharp corners feel "cheap" and "industrial"; rounded corners feel "custom" and "designed."

---

## 7. Responsive Philosophy: Fluidity
The ERP must transition from a "Management Dashboard" (Desktop) to a "Warehouse Tool" (Mobile).
*   **Desktop:** Focus on high-density information using Tonal Layering to group massive datasets.
*   **Mobile:** Focus on "The Stack." Convert horizontal tables into vertical cards, increasing the size of touch targets and utilizing the "Glass Dock" for navigation.