# Sherivs Motion System

Motion is a state signal. The public site uses almost none: color and type carry the hierarchy.

## Tokens

Declared in `frontend/src/lib/sherivs/tokens.ts`:

| Token | Value |
| --- | --- |
| Instant | 80ms |
| Fast | 140ms |
| Base | 220ms |
| Slow | 360ms |
| Standard easing | cubic-bezier(0.2, 0, 0, 1) |
| Enter easing | cubic-bezier(0.16, 1, 0.3, 1) |

## Reduced motion

`frontend/src/styles.css` collapses animation duration, iteration, and transition duration under `prefers-reduced-motion: reduce`.

## What was not added

Page-transition choreography, particle fields, parallax, and an intelligence "thinking" loop. A thinking animation is only appropriate while a real request is in flight. No such indicator was added to the public site, because the public site does not call a model.

Existing application animations remain. They now honor the reduced-motion rule.
