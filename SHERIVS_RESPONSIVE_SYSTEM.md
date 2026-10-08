# Sherivs Responsive System

Status: `PROPOSED`  
Version target: `ACTIVE-V1`

## Viewport reference

The system explicitly reviews 360, 390, 430, 768, 1024, 1280, 1440, 1600, 1920, and 2560+ CSS pixels. Components respond to available space rather than device names.

## Composition modes

|      Width | Primary composition                                                         |
| ---------: | --------------------------------------------------------------------------- |
|    360–430 | Single task column, compact header, bottom destinations, contextual sheets  |
|        768 | Single or master-detail layout; persistent controls only when space permits |
|       1024 | Collapsible workspace navigation, main content, optional transient context  |
|  1280–1600 | Persistent navigation, bounded main content, optional secondary panel       |
| 1920–2560+ | Multi-pane operational layout with bounded reading/data measures            |

## Rules

- Mobile navigation is prioritized independently; it is not the entire desktop sidebar in a drawer.
- Global actions remain reachable with one thumb or command/search entry.
- Safe-area insets protect fixed controls.
- Tables prioritize fields into record rows/cards only when scanning remains clear; otherwise provide controlled horizontal access with frozen context.
- Forms use one column until field relationships justify a grid.
- Reading content has a bounded measure; data workspaces can use wider canvases.
- Overlays become full-height sheets on narrow screens when task continuity improves.
- Hover is enhancement only; pointer, keyboard, and touch behaviors are equivalent.
- Text zoom and localization may trigger the next narrower composition.

## Existing baseline

Current web behavior uses Tailwind breakpoints, a `<768px` mobile hook, sheet sidebar, optional bottom navigation, and limited `ResponsiveTable` adoption. Mobile has a separate Expo navigation stack. Adoption is inconsistent across route modules and requires route-level verification.

## Test matrix

For every major shell and workflow verify:

- no horizontal page overflow;
- visible focus and logical reading order;
- 44px touch targets;
- keyboard and screen-reader access;
- long labels, 200% zoom, and dense real data;
- empty, loading, error, offline, and permission states;
- portrait/landscape where supported;
- reduced motion and both themes;
- organization branding does not break layout.
