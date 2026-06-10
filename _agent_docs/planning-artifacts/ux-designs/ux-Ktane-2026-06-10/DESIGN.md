---
name: Bomb Squad — Visual Identity
project: Ktane
status: final
updated: 2026-06-10
sources:
  - ../../briefs/brief-Ktane-2026-06-09/brief.md
  - ../../gdds/gdd-Ktane-2026-06-09/gdd.md
  - ../../../project-context.md
colors:
  brand:
    bakelite: "#C2491F"        # warm 1960s prop orange — primary chassis
    bakeliteDeep: "#7A2A10"    # shadowed chassis edge
    cream: "#E8DCC2"           # printed-manual paper, panel labels
    graphite: "#1A1A1F"        # bomb steel, deep contrast
    brass: "#B8924A"           # screws, hinges, accents
  hud:
    ledGreen: "#3DFF7A"        # solved module LED, "armed/clear" cue
    ledGreenGlow: "#15B548"
    ledAmber: "#FFB300"        # strike 1, caution
    ledRed: "#FF2E2E"          # strike 2, error, explode
    ledRedGlow: "#7A0000"
    timerLcd: "#FF3B30"        # 7-segment LCD red
    timerLcdBg: "#240807"
  ui:
    surface: "#161318"         # app shell background
    surfaceRaised: "#221E26"   # panel background
    surfaceManual: "#F2E8D0"   # manual page (printed paper)
    inkPrimary: "#F4ECDA"      # text on dark
    inkManual: "#1A1410"       # text on manual page
    inkMuted: "#9A8E78"
    focus: "#3DFF7A"           # keyboard focus ring (matches LED green)
    danger: "#FF2E2E"
  voice:
    speakerActive: "#3DFF7A"
    speakerSelf: "#4FB8FF"     # cool blue for self-indicator
    muted: "#6B6470"
typography:
  display:
    family: "'Space Grotesk', 'Inter', system-ui, sans-serif"
    weights: [600, 700]
    use: "Title screen, scoreboard headlines, modal headings"
  body:
    family: "'Inter', system-ui, sans-serif"
    weights: [400, 500, 600]
    use: "Menus, lobby, dashboard, toasts, microcopy"
  manual:
    family: "'Source Serif 4', 'Georgia', serif"
    weights: [400, 600]
    use: "Manual chapter headings + body — printed defusal handbook feel"
  mono:
    family: "'JetBrains Mono', 'IBM Plex Mono', monospace"
    weights: [500, 700]
    use: "Serial number, indicator labels (FRK/CAR/SND/etc.), join codes, debug"
  lcd:
    family: "'DSEG7 Classic', 'Share Tech Mono', monospace"
    weights: [400]
    use: "Bomb timer 7-segment readout, Morse Code frequency display"
  scale:
    xs: "11px"
    sm: "13px"
    base: "15px"
    md: "17px"
    lg: "22px"
    xl: "32px"
    "2xl": "48px"
    timer: "84px"
rounded:
  none: "0"
  sm: "2px"
  md: "4px"
  lg: "8px"
  chassis: "6px"        # bomb panel corners — barely rounded, industrial
  pill: "9999px"
spacing:
  unit: "4px"
  hudGutter: "24px"
  panelInset: "16px"
  safeArea: "32px"      # HUD elements stay this far from viewport edges
components:
  button:
    primary:
      bg: "{colors.brand.bakelite}"
      bgHover: "#D85A2A"
      ink: "{colors.brand.cream}"
      border: "2px solid {colors.brand.bakeliteDeep}"
      radius: "{rounded.md}"
      padding: "12px 20px"
      typography: "{typography.body} 600 {typography.scale.base}"
      shadow: "0 2px 0 {colors.brand.bakeliteDeep}, 0 4px 12px rgba(0,0,0,0.4)"
      press: "translateY(2px); shadow:none"
    secondary:
      bg: "transparent"
      ink: "{colors.ui.inkPrimary}"
      border: "2px solid {colors.ui.inkMuted}"
      radius: "{rounded.md}"
      padding: "10px 18px"
    danger:
      bg: "{colors.hud.ledRed}"
      ink: "#FFFFFF"
  panel:
    chassis:
      bg: "{colors.brand.graphite}"
      border: "1px solid {colors.brand.brass}"
      radius: "{rounded.chassis}"
      shadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.5)"
      use: "Bomb-room overlays anchored to the chassis aesthetic"
    manualPage:
      bg: "{colors.ui.surfaceManual}"
      ink: "{colors.ui.inkManual}"
      border: "1px solid #C9BC9D"
      radius: "{rounded.sm}"
      shadow: "0 4px 16px rgba(0,0,0,0.35)"
      texture: "subtle paper grain, 2% noise overlay"
  timer:
    bg: "{colors.hud.timerLcdBg}"
    ink: "{colors.hud.timerLcd}"
    typography: "{typography.lcd} {typography.scale.timer}"
    border: "2px solid {colors.brand.graphite}"
    radius: "{rounded.sm}"
    glow: "0 0 16px rgba(255,59,48,0.45)"
    pulseOnStrike: "1.5× speed; +20% glow intensity per strike"
  strikeIndicator:
    layout: "row of 2 LED dots beside the timer"
    states:
      inactive: "{colors.hud.ledRedGlow}, opacity 0.25"
      active: "{colors.hud.ledRed}, glow 0 0 12px"
  moduleSolveLed:
    size: "10px circular"
    states:
      unsolved: "{colors.hud.ledRedGlow}, dim"
      solved: "{colors.hud.ledGreen}, glow 0 0 8px {colors.hud.ledGreenGlow}"
      striking: "{colors.hud.ledRed}, 600ms flash"
  speakerIndicator:
    shape: "pill with avatar dot + name"
    states:
      idle: "bg {colors.ui.surfaceRaised}, ink {colors.ui.inkMuted}"
      active: "bg {colors.brand.graphite}, ring 2px {colors.voice.speakerActive}, animated 800ms pulse"
      selfActive: "ring {colors.voice.speakerSelf}"
      muted: "ink {colors.voice.muted}, strike-through mic glyph"
  toast:
    bg: "{colors.brand.graphite}"
    ink: "{colors.brand.cream}"
    border: "1px solid {colors.brand.brass}"
    radius: "{rounded.md}"
    durationDefault: "5s"
    durationLifeline: "8s"
  joinCodeInput:
    typography: "{typography.mono} 700 {typography.scale.xl}"
    letterSpacing: "0.2em"
    chassis: "boxed per-character cells"
---

# Bomb Squad — Visual Identity

## Brand & Style

**Voice of the visual:** a chunky, slightly-absurd 1960s spy-thriller prop bomb sitting on a steel workbench. Cartoony enough that the violence is comedic, industrial enough that the modules feel like real hardware. The defuser handles the bomb; the experts read a printed-feeling handbook. Drama is supplied by the players — the visual language stays composed and legible under voice-driven stress.

**Anchoring references:** Keep Talking and Nobody Explodes module language; mid-century Bakelite electronics; printed military field manuals; arcade-cabinet 7-segment displays.

**Tone words:** industrial, deliberate, tactile, high-contrast, knowable in a glance.

## Colors

Two color worlds coexist:

- **Bomb world (diegetic):** Bakelite orange chassis, graphite steel, brass screws, LED reds/greens/ambers, 7-segment LCD red. Everything that lives *on the bomb* uses this palette.
- **Operator world (non-diegetic):** dark app shell (`{colors.ui.surface}`), cream ink, manual paper for Expert and Spectator manual panes, cool blue (`{colors.voice.speakerSelf}`) for *your own* voice presence so it never competes with red/green game-state semantics.

`[CONFIRMED 2026-06-10]` Palette direction (Bakelite orange + graphite + LED accents) approved by Jay. This is the locked aesthetic family for V1 — the design-token system (Story 2.1) builds on it.

**Semantic reservations** — never violate:
- **LED green** = solved / safe / armed-clear.
- **LED red** = strike / error / explode.
- **LED amber** = caution / strike-1 escalation cue.
- **Cool blue** = self / you (voice presence only).
- **Cream paper** = manual content; never used for game-state signaling.

## Typography

Five families, each with one job:

- **Display** (`Space Grotesk`) — title screen, scoreboard headlines. Geometric, confident.
- **Body** (`Inter`) — every menu, dashboard, lobby, toast. Default workhorse.
- **Manual** (`Source Serif 4`) — the Expert's defusal handbook. The serif is the single strongest cue that the manual is *a different surface* than the game UI.
- **Mono** (`JetBrains Mono`) — serial numbers, indicator labels (FRK/CAR/SND), join codes. Anywhere alphanumeric identity matters more than reading flow.
- **LCD** (`DSEG7 Classic`) — bomb timer + Morse frequency dial only. Diegetic device displays.

Body scale steps are coarse on purpose — at 60fps voice-stress legibility, micro-adjustments aren't worth the inconsistency cost.

## Layout & Spacing

Base unit 4px. The bomb scene owns the canvas; HUD chrome sits on a `{spacing.safeArea}` inset from viewport edges so timer/strike/speaker indicators never crowd the chassis. Manual viewer and facilitator dashboard use a two-column max layout (chapter list / content) — no nested scrolling regions, ever, because lost scroll position under time pressure is a usability failure.

Bomb chassis radius (`{rounded.chassis}`) is intentionally tight (6px) — these are machined panels, not soft consumer products.

## Elevation & Depth

Three depth tiers, no more:

1. **In-world (the bomb):** R3F-rendered 3D, lit. Real shadows, real materials.
2. **HUD overlays:** flat 2D, dropped onto the scene with a single soft shadow. Timer, strikes, speaker pills, mute control.
3. **Modal / dashboard surfaces:** full-bleed dim of the scene (`rgba(0,0,0,0.55)` scrim) + raised panel.

The manual viewer is a special case: when an Expert opens it, the panel reads as "paper laid on the table" — paper shadow, slight rotation allowed at most 1°. Never floats like a generic web modal.

## Shapes

- Bomb-world UI: rectilinear with `{rounded.chassis}` corners.
- Operator-world UI: standard `{rounded.md}` for buttons, `{rounded.lg}` for cards.
- LEDs and speaker indicators: pure circles / pills.
- Manual pages: near-zero radius (`{rounded.sm}`) — they're sheets of paper.

## Components

See frontmatter for token-level specs. Headline patterns:

- **Primary button** has a physical "press" — translates 2px on active, removes its own shadow. This is the only place we use a tactile press effect, and it earns the dopamine of "I just defused something."
- **Timer** is the loudest element on screen by design. 84px LCD red on near-black; glow intensifies per strike. If the timer is competing for attention with anything else in the HUD, the HUD is wrong.
- **Module solve LED** is the single source of truth for module state — green = done. Defuser learns the bomb by scanning greens.
- **Speaker indicator** uses cool blue for *self* and LED-green for *active speaker* so the colorblind-safe layer (shape + position + name label) carries the load even if the colors fail.
- **Manual page** is paper. Background, ink, shadow, optional grain. It must never look like a Bootstrap card.

## Do's and Don'ts

**Do**
- Treat the bomb as a physical object with real lighting; treat the HUD as flat overlays.
- Keep LED-green / LED-red / LED-amber strictly semantic — solved / error / caution. Never decorative.
- Use the manual's serif typeface and paper texture as the *primary* signal that "you're reading rules, not playing the game."
- Reserve cool blue for "this is you" presence cues.
- Always pair color with shape or label for module state (colorblind floor).

**Don't**
- Don't introduce a fourth UI surface. Bomb / HUD overlay / modal-or-manual — that's it.
- Don't animate the timer's digits — only its glow. Digit animation reads as a glitch under time pressure.
- Don't use the brass/Bakelite palette in the facilitator dashboard — the dashboard is operator-world, not bomb-world.
- Don't put real military or graphic-violent iconography anywhere. This is comedic spy-thriller, not tactical-realism.
- Don't use music. SFX only. (Carried from GDD: "the team's voice is the soundtrack.")
- Don't use color alone for Wires, The Button, Simon Says, or Complicated Wires module state — patterns/labels required (accessibility floor).
