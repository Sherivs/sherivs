# Sherivs Responsive System

Version target: **V1**.

Breakpoints in the token contract: 360, 390, 430, 768, 1024, 1280, 1440, 1600, 1920.

## Public

- Below 768px the primary nav is hidden. Sign in and the wordmark remain. Section links are in the footer, which stacks. This is a deliberate mobile IA, not a shrunk desktop bar. A disclosure menu was not added because the footer already carries every public section and a hamburger would duplicate it without a new destination.
- Plane rows collapse from two columns to one.
- Display type uses `clamp` so 360px still shows the wordmark as a word, not a clipped image.
- The global mobile `h1` size rule does not apply inside `.sx-public`; the public scale wins by specificity.
- Pricing becomes a single column, then two at 768px, then three at 1280px.
- No horizontal page scroll is introduced by the public frame (`width: min(72rem, calc(100% - 2rem))`).

## Application

Existing shell behavior is unchanged: collapsible sidebar, swipe to open, bottom navigation for the parent and student portals, scrollable tables, 16px inputs under 640px to avoid iOS zoom, 44px targets on coarse pointers.

## Mobile app

The Expo app keeps its own information architecture: home, organization, missions, agents, evidence, settings. It is not a reflow of the desktop sidebar.

## Not verified in a device lab

Desktop and mobile screenshots of the public home and one interior page are the visual check for this change. Ultrawide behavior is the same centered measure, not a stretched layout.
