# SHERIVS ACCESSIBILITY SYSTEM (SAS-v1.0)
**System:** Inclusive Design, Screen-Reader Semantics, and WCAG 2.2 AA+ Compliance  
**Status:** Canonical Accessibility Specification  

---

## 1. Compliance Baseline & Philosophy

Sherivs is built to serve entire institutional populations — from sovereign leadership and administrators to teachers, parents, and students with diverse sensory, motor, and cognitive abilities.

The baseline standard is **WCAG 2.2 Level AA**, with Level AAA targeted for typography contrast, focus visibility, and form error resilience.

---

## 2. Accessible Semantics & Structure

1. **Heading Outlines:**
   - Every page features exactly one logical `<h1>` element representing the main entity or view title.
   - Headings strictly follow mathematical hierarchy (`h1` → `h2` → `h3`) without skipping levels for visual formatting.
2. **Landmarks:**
   - Every surface uses native HTML5 landmarks: `<header>`, `<nav>`, `<main id="main-content">`, `<aside>`, and `<footer>`.
   - Skip links (`<a href="#main-content" className="sr-only focus:not-sr-only">Skip to main content</a>`) are positioned at the top of every authenticated and public shell.
3. **Form Associations:**
   - Every form input is programmatically bound to its `<label>` via matching `id` and `htmlFor` attributes.
   - Helpful guidance is linked via `aria-describedby`, and validation failures are linked via `aria-errormessage`.

---

## 3. Keyboard Navigation & Focus Management

- **Universal Tab Navigation:** Every interactive element is reachable via keyboard (`Tab` and `Shift+Tab`).
- **Focus Rings:** Interactive elements present a prominent, high-contrast 2px cyan focus ring (`--sherivs-cyan-500`) with a 2px offset. Focus outlines are never removed (`outline: none` without replacement is forbidden).
- **Dialog Focus Traps:** When a modal dialogue, command palette, or slide-over drawer opens, focus is immediately moved inside the container and trapped until dismissed via `Esc` or button. Upon closing, focus restores to the triggering element.
- **Data Grids:** Arrow keys (`Up`, `Down`, `Left`, `Right`) allow navigating complex data tables and calendar grids.

---

## 4. Contrast & Visual Accommodations

- **Text Contrast:** Regular text satisfies a minimum contrast ratio of **4.5:1** against its backing surface; large text (18pt / 24px+) and high-density telemetry satisfy **7:1** (AAA standard).
- **Color Independence:** Color is never the sole indicator of state. Badges and alerts always pair semantic color with an explicit textual label and distinct vector icon (e.g., green checkmark for `Verified`, red shield for `Breach`, yellow triangle for `Warning`).
- **Touch Targets:** On touch and mobile viewports, all interactive hit targets maintain a minimum dimension of **44x44 CSS pixels**.
