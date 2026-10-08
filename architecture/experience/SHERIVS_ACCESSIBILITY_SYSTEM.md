# Sherivs Accessibility System

**Target:** WCAG 2.2 AA where practical.

Shipped in this wave:

- Skip link in root shell  
- Landmarks on public shell  
- Breadcrumbs on public articles  
- Visible `:focus-visible` using `--ring`  
- Mobile menu `aria-expanded` / `aria-controls`  
- Account motion/contrast/density preferences  
- Semantic tables for pricing  
- Empty/error copy that does not rely on color alone  
- Touch targets and 16px inputs on small screens (existing)

Known gaps (honest):

- Command palette still contains Scholar-specific student search  
- Many role portal tables need further caption/scope work  
- English-only UI (`SUPPORTED_LOCALES = ["en"]`)  
- MFA/SSO UI not present
