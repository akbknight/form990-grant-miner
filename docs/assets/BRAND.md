# AK Bridge Monogram — Brand Guide

## Concept

The letters A and K share a single vertical stroke — the right side of the A
is simultaneously the stem of the K. This "bridge" represents the core of
Akshay's identity: connecting engineering rigor with strategic thinking,
data infrastructure with human outcomes, code with communication.

Five strokes total: A's left diagonal, the shared vertical, A's crossbar,
K's upper arm, K's lower arm. Nothing decorative. Every line is structural.

## Files

| File | Purpose | Size |
|------|---------|------|
| `logo-mark.svg` | Standalone mark, uses `currentColor` | 120×120 |
| `logo-contained.svg` | Mark inside amber rounded rect | 120×120 |
| `favicon.svg` | Browser tab icon, bolder strokes | 32×32 |

## Colors

**Primary accent (the container):**
- Dark mode: `#E8A020` (warm amber gold)
- Light mode: `#B37600` (darker amber for contrast)

**Mark strokes on accent background:** `#09090B` (near-black)

**Mark strokes on page (standalone):** Use `currentColor` — the mark
inherits whatever text color the context provides. On dark backgrounds
it renders light; on light backgrounds it renders dark.

## Dark / Light Mode Usage

The **contained variant** (amber rect + dark strokes) works identically in
both modes because the amber container provides its own contrast.

The **standalone mark** adapts automatically via `currentColor`. No separate
dark/light SVG files needed.

## Where to Use Which Version

| Context | File | Notes |
|---------|------|-------|
| Browser tab / favicon | `favicon.svg` | Wired via Next.js metadata |
| Navbar (28×28) | Inline SVG component | In `Navbar.tsx`, same design |
| Social / profile avatar | `logo-contained.svg` | Square, self-contained |
| Hero / large display | `logo-mark.svg` | Scales cleanly to any size |
| Print / docs | `logo-mark.svg` | Vector, infinite resolution |
| On colored backgrounds | `logo-mark.svg` | `currentColor` adapts |

## Spacing / Clear Space

Minimum clear space around the mark: **equal to the stroke width**.
At the primary 120×120 size, that's 11px on all sides.
At favicon size, the rounded rect container handles spacing.

Never crowd the mark with adjacent elements. The negative space between
strokes is part of the design.

## Typography Pairing

The mark is designed to sit alongside:
- **Satoshi** (500 weight, 0.14em letter-spacing, uppercase) for formal lockups
- **Zodiak** for editorial/display contexts
- **JetBrains Mono** for developer/technical contexts

## Don'ts

- Don't rotate or skew the mark
- Don't change the stroke proportions
- Don't add gradients, shadows, or effects
- Don't outline the strokes into filled shapes (keep them as strokes for scalability)
- Don't use colors other than the defined palette
- Don't place the contained variant on the amber accent color (no amber-on-amber)
