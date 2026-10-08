# Sherivs Responsive System

Status: Target behavior and test matrix  
Version target: ACTIVE-V1

## Viewport classes

| Width | Primary intent |
| --- | --- |
| 360 / 390 / 430 | phone; thumb-first single task |
| 768 | tablet portrait; optional supporting region |
| 1024 | tablet landscape/small laptop; collapsible rail |
| 1280 / 1440 | standard workspace |
| 1600 / 1920 | expanded workspace with bounded reading widths |
| 2560+ | ultrawide; multi-panel where task benefits, never stretched prose |

Breakpoints are test points, not device assumptions. Components respond to available container
space where practical.

## Shell behavior

- Phone: compact context header, bottom navigation (maximum five primary items), search/command
  access, secondary navigation sheet, contextual action sheet.
- Tablet: collapsible navigation rail; optional detail panel; touch-safe density.
- Desktop: persistent capability navigation, flexible content, optional contextual panel.
- Ultrawide: bounded main column; comparison, monitoring, or spatial tasks may use additional
  panels. Empty width is acceptable.

## Content behavior

- Prose retains readable line length.
- Page actions wrap below titles before labels truncate.
- Tables prioritize columns, support horizontal comparison when necessary, and provide record-list
  or detail-sheet alternatives on phones.
- Charts simplify labels and retain accessible summaries; they never become unreadable miniatures.
- Forms remain single column on phones and group only semantically related short fields on larger
  screens.
- Dialogs become edge-safe sheets on small screens when content length requires it.
- Navigation, tabs, filters, and breadcrumbs scroll or collapse with explicit overflow affordance.

## Input and environment

Support touch, mouse, keyboard, coarse/fine pointers, portrait/landscape, display cutouts, virtual
keyboard, text zoom, and reduced motion. Fixed elements honor safe-area insets. Input text remains
at least 16px on iOS to avoid unintended zoom.

## Density

Comfortable is default. Compact density is allowed for high-volume tables and operations on
adequate viewports; it never reduces touch targets or text below accessible limits. User preference
is policy-governed and persists by identity.

## Performance

Responsive images declare dimensions and `srcset/sizes`; noncritical media is lazy loaded. Mobile
does not download desktop-only video or visualization code. Panels and heavy routes are split and
loaded on demand. Blur area and simultaneous animations are constrained.

## Current findings

The existing system has mobile padding, 380/640/768/1024 behaviors, responsive tables, bottom
navigation, mobile drawers, swipe-to-open, touch targets, PWA assets, and offline banner. It lacks
a complete 360→2560 test contract, container-query strategy, ultrawide composition, consistent
mobile table transformations, safe-area specification, and evidence for every authenticated route.

## Verification matrix

For every major shell and template, capture at 360, 390, 430, 768, 1024, 1280, 1440, 1600, 1920,
and 2560 widths with:

- default, long localized strings, maximum realistic data, zero data;
- loading, error, denied, offline, and stale states;
- 200% text zoom and keyboard focus;
- light, dark, and high-contrast themes;
- portrait/landscape where applicable.

No horizontal page overflow, clipped focus, unreachable action, obscured input, or content hidden
only to make the layout fit is acceptable.
