# Sherivs Accessibility System

**Version-target:** ACTIVE-V1  
**Target:** WCAG 2.2 AA on new experience surfaces

## Implemented

- Skip link to `#main-content` (`__root.tsx`)
- Landmarks on public and application shells
- Focus-visible outlines (signal color)
- Mobile disclosure `aria-expanded` / `aria-controls`
- Labeled homepage sections (`aria-labelledby`)
- Form labels on auth and settings
- Command palette keyboard support
- Reduced-motion collapse
- 44px touch targets on coarse pointers
- 16px inputs on small screens (iOS zoom guard)

## Accounted but incomplete

- Not every legacy Scholar admin table is fully accessible
- No dedicated high-contrast theme beyond token contrast
- Screen-reader live regions for route errors are partial (`role="alert"` on status failure)

New Sherivs surfaces must ship keyboard, contrast, empty, loading, error, and unauthorized states.
