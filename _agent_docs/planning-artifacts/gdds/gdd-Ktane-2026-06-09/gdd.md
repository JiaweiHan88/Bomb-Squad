---
title: 'Bomb Squad — Game Design Document'
game_type: 'Party Game (Real-time Cooperative/Competitive Puzzle)'
platforms: 'Desktop Browser (Chrome 90+, Firefox 88+, Edge 90+; Safari secondary)'
created: '2026-06-09'
updated: '2026-06-10'
author: 'Jay'
status: 'draft'
---

# Bomb Squad — Game Design Document

**Author:** Jay
**Game Type:** Party Game — Real-time Cooperative/Competitive Puzzle
**Target Platform(s):** Desktop Browser (Chrome 90+, Firefox 88+, Edge 90+; Safari secondary)

---

## Executive Summary

### Core Concept

Bomb Squad drops up to 16 players (two teams of 8) into a high-pressure bomb defusal scenario where the Defuser can see the bomb but cannot read the manual, and the Experts can read the manual but cannot see the bomb. The only tool anyone has is their voice. Teams race through identical bomb layouts in a relay format, accumulating defuse time across rounds until every player has taken a turn as Defuser. The team with the lowest cumulative time wins.

The game runs in any modern desktop browser with no downloads, no accounts, and no external voice tools required. A Facilitator creates a private session, shares a link, and the team plays within minutes.

**Core fantasy:** Your team survives (or spectacularly fails) a bomb defusal by communicating precisely under pressure — and then argues about it for the rest of the day.

**Vision:** Bomb Squad is the team-building activity that accidentally reveals how your team communicates. It is tense, funny, and immediately replayable. Every round produces a story.

### Target Audience

Internal teams of any role — engineering, product, design, data, management — organised by a team lead or event organiser. Players need only a browser and a microphone. No gaming experience required; rules are learnable in under two minutes. Sessions run 45–90 minutes including setup, rounds, and informal debrief. Player count: 2–16 per session.

### Unique Selling Points

1. **Built-in voice, zero friction** — no Zoom, no Discord, no external PDF. Everything is in the browser.
2. **Competitive relay structure** — two teams race the same bomb, every player defuses once. KTANE was a single-player spectacle; Bomb Squad is a team sport.
3. **Asymmetric Expert Roles** — optionally distribute manual chapters across Experts, forcing Expert-to-Expert coordination on top of Defuser-Expert communication.
4. **Spectator Lifelines** — spectators earn tokens and spend them on pre-defined hint prompts, making the audience a meaningful part of the session.
5. **Every round produces a story** — randomised values on familiar module layouts mean every defusal is a new communication problem. The debrief is interesting because everyone experienced something different.

---

## Goals and Context

### Project Goals

- Deliver a repeatable team ritual: 30 minutes of communication under pressure followed by a debrief that is genuinely interesting because every player has a story.
- Validate the hypothesis that information-asymmetry mechanics reveal how a team communicates.
- Ship a self-hosted tool that any team lead can spin up in under 3 minutes.
- Open-source the codebase after initial internal use.

**Scope philosophy:** This is a purposefully contained internal tool — not a platform, not a service, not a progression game. Restrained scope is a design identity, not a resourcing constraint.

**Core hypothesis (MVP):** Two players in a browser — one sees the bomb, one sees the manual, they solve Wires together over voice. If this is tense and satisfying, the core mechanic works. Everything else is content and polish.

### Background and Rationale

Inspired by *Keep Talking and Nobody Explodes* (Steel Crate Games). Taking: information-asymmetry mechanic, bomb aesthetic, manual-as-puzzle, module system. Not taking: KTaNE's single-player structure requiring one person to run the game with an external PDF. Bomb Squad is rebuilt for groups, with built-in voice and a competitive relay format.

Jackbox Party Pack informs the join flow: browser link, join code, Facilitator-driven pacing, zero onboarding friction.

---

## Core Gameplay

### Game Pillars

**1. Communication is the mechanic.**
The Defuser and Experts are information-asymmetric by design. The Defuser sees the bomb but cannot read the manual; Experts read the manual but cannot see the bomb. The gap between what the Defuser sees and what the manual says is the entire game. Modules force precise verbal description and interpretation — not general knowledge, reflexes, or prior game experience.

**2. Pressure is shared.**
The timer and strike limit apply to the whole team. Failure is collective. A wrong press is the Expert's fault as much as the Defuser's — this prevents blame and creates shared investment. Strikes are team-wide, not assigned to individuals.

**3. Fairness through structure.**
Both teams receive identical module layouts with independently randomised values. The relay race format ensures every player defuses at least once. The Facilitator controls pacing, difficulty, and round count. Outcomes are determined by team performance, not luck of the draw.

**4. The bomb is always new; the team gets better.**
No two sessions produce the same bomb. Module combinations, values, and wire layouts are randomised each round, so every defusal is a fresh communication problem. The ceiling rises as teams build shared language and trust across sessions — a team's third game is faster than their first not because the modules got easier, but because the team did.

### Core Gameplay Loop

```
[Lobby] Facilitator creates session, shares link + join code; players join; teams assigned
  → [Preparation] All players browse manual; Defuser sees module types (not values)
  →   Prep phase is Facilitator-controlled [ASSUMPTION: 2–5 min default]
  → [Round start] Facilitator configures round (difficulty, module count, timer, modifiers)
  → Facilitator assigns Defuser by rotation order (default: team join order)
  → [If Asymmetric Expert Roles on] Manual chapters auto-assigned round-robin to Experts
  → Players route to voice channels (Bomb Room or Spectator Lounge)
  → Bomb timer starts
  → Defuser describes what they see; Experts interpret the manual and give instructions
  → Team defuses all modules (success) OR accumulates 3 strikes / timer expires (failure)
  → Time recorded; round ends
  → [Between rounds] Scoreboard preview shown to all players; Facilitator manually advances
  → Roles rotate to next player as Defuser
  → Repeat until all players have defused at least once
  → [Session end] Final scoreboard displayed
```

**Pause:** The Facilitator can pause at any time between rounds. Mid-round, a pause is triggered automatically on player disconnect. Pause freezes the countdown timer and bomb state; voice channels remain active. Facilitator resumes manually.

### Win/Loss Conditions

**Round success:** All modules defused before the timer reaches 0:00 and before 3 strikes. Elapsed time recorded and added to cumulative total.

**Round failure — explosion:** Timer reaches 0:00, or the team accumulates 3 strikes. Round ends immediately. Time at the moment of failure is recorded. Default: advance to next round. Facilitator may optionally trigger a retry of the same round; if retried, the better of the two times is recorded.

**Strike escalation:** Each strike increases the countdown speed by a configurable percentage (0–50%, compounding; default 25%).

| Strikes | Speed multiplier (at default 25%) |
|---|---|
| 0 | ×1.00 |
| 1 | ×1.25 |
| 2 | ×1.56 |
| 3 | Explosion — round over |

**Session winner:** Team with the lowest cumulative defuse time across all rounds wins.

---

## Game Mechanics

### Primary Mechanics

#### Information Asymmetry
The core mechanic. The Defuser sees the bomb in 3D but has no manual access. Experts see the digital manual but cannot see the bomb. Every module is a structured communication problem solved entirely through voice.

#### Module Defusal
Each bomb contains 3–11 modules (Facilitator-configured). Modules can be defused in any order. A green LED on a module indicates it is disarmed. All modules must be disarmed to defuse the bomb.

#### Strike System
Incorrect module interactions record a strike against the team. The bomb explodes on the third strike. After each strike, the countdown timer accelerates by a configurable percentage (0–50%, compounding; default 25%). Strikes are shared — no individual attribution.

#### Relay Race Format
Sessions are structured as a relay. Both teams play the same rounds sequentially. Every player defuses at least once. The relay is a story-generation mechanism as much as a fairness mechanism — every player's turn produces a distinct defusal experience, which is what makes the post-session debrief genuinely interesting. Cumulative defuse time determines the winner.

#### Asymmetric Expert Roles *(Facilitator-toggleable)*
When enabled, the 11 manual chapters are auto-assigned round-robin across Experts at round start — distributed as evenly as possible, randomly allocated. Each Expert can only access their assigned chapters. Only activates with 2 or more Experts; a solo Expert retains full manual access.

#### Spectator Lifelines *(Facilitator-toggleable)*
Spectators earn 1 lifeline token per round spectated (max 3 held). A token pushes a pre-defined hint prompt to both Defuser and Experts as an overlay:
- "Re-read the [module name] section"
- "Check the serial number"
- "You missed a condition"
- "You're on the right track"
- "Wrong approach"

No free-text input. Facilitator can disable per session.

Lifeline overlay behaviour: the prompt is displayed as a non-blocking banner to both Defuser and Experts for 8 seconds, then auto-dismisses. [ASSUMPTION: 8-second duration; to be validated during playtesting.] Neither Defuser nor Expert can dismiss it early — it is informational, not interactive.

---

### Module Mechanics

All rules are sourced from the *Keep Talking and Nobody Explodes Bomb Defusal Manual, v1 (verification code 241)*.

#### Global Bomb Information

Every bomb has the following metadata used across multiple modules:

- **Serial number** — alphanumeric string on the bomb casing. Rules reference: last digit (odd/even) and whether it contains a vowel (A, E, I, O, U).
- **Batteries** — AA or D batteries in enclosures on the casing. Rules reference total count.
- **Indicators** — labelled lit/unlit lights on the casing. Labels: SND, CLR, CAR, IND, FRQ, SIG, NSA, MSA, TRN, BOB, FRK.
- **Ports** — DVI-D, Parallel, PS/2, RJ-45, Serial, Stereo RCA.

---

#### Module 1: Wires

The module displays 3–6 coloured wires. Cut exactly one wire to disarm.

**3 wires:**
1. No red wires → cut **2nd**
2. Last wire is white → cut **last**
3. More than one blue wire → cut **last blue**
4. Otherwise → cut **last**

**4 wires:**
1. More than one red wire AND last serial digit odd → cut **last red**
2. Last wire is yellow AND no red wires → cut **1st**
3. Exactly one blue wire → cut **1st**
4. More than one yellow wire → cut **last**
5. Otherwise → cut **2nd**

**5 wires:**
1. Last wire is black AND last serial digit odd → cut **4th**
2. Exactly one red wire AND more than one yellow wire → cut **1st**
3. No black wires → cut **2nd**
4. Otherwise → cut **1st**

**6 wires:**
1. No yellow wires AND last serial digit odd → cut **3rd**
2. Exactly one yellow wire AND more than one white wire → cut **4th**
3. No red wires → cut **last**
4. Otherwise → cut **4th**

---

#### Module 2: The Button

A single coloured button with a label. Evaluate rules in order; apply the first that matches.

**Press/hold decision:**
1. Blue + label "Abort" → **hold**
2. More than 1 battery + label "Detonate" → **press and release**
3. White + lit CAR indicator → **hold**
4. More than 2 batteries + lit FRK indicator → **press and release**
5. Yellow → **hold**
6. Red + label "Hold" → **press and release**
7. None of the above → **hold**

**Releasing a held button** (a coloured strip lights up on the right side of the module):

| Strip colour | Release when the timer shows... |
|---|---|
| Blue | a **4** in any position |
| White | a **1** in any position |
| Yellow | a **5** in any position |
| Any other | a **1** in any position |

---

#### Module 3: Keypads

Four symbols on a 2×2 grid. Exactly one column in the reference table contains all four symbols. Press the buttons in the order their symbols appear top-to-bottom in that column.

**Symbol columns** (6 columns, 7 symbols each — visual glyphs, see manual p.7 for authoritative reference):

| Position | Col 1 | Col 2 | Col 3 | Col 4 | Col 5 | Col 6 |
|---|---|---|---|---|---|---|
| 1 | Q-mirror | Э-umlaut | © | б | Ψ | б |
| 2 | λ-serif | Q-mirror | ω-hook | ¶ | ·· (dots) | Э-umlaut |
| 3 | λ-italic | Э (plain) | ω-macron | Ъ | Ъ | ✶ (4-star) |
| 4 | ħ (barred h) | ω-macron | Ж | H-Ж | C-dot | æ |
| 5 | H-Z crossed | ☆ (star) | Ʒ (rev-3) | Ж | ¶ | Ψ |
| 6 | ψ-tail | λ-italic | λ-italic | ¿-variant | Ӡ-cedilla | Ӣ |
| 7 | )-dot | ¿ | ☆ (star) | ·· (dots) | ★ (solid) | Ω |

> Implementation note: symbols are custom glyphs. The table above uses closest Unicode approximations. Authoritative visual reference is the manual PDF, page 7.

---

#### Module 4: Simon Says

A flashing sequence of coloured buttons (Blue top, Red left, Yellow right, Green bottom). Translate each flash using the correct table and press the corresponding button. Sequence grows by one each time it is correctly entered.

**Table A — Serial number CONTAINS a vowel:**

| | Red flash | Blue flash | Green flash | Yellow flash |
|---|---|---|---|---|
| 0 strikes | Blue | Red | Yellow | Green |
| 1 strike | Yellow | Green | Blue | Red |
| 2 strikes | Green | Red | Yellow | Blue |

**Table B — Serial number does NOT contain a vowel:**

| | Red flash | Blue flash | Green flash | Yellow flash |
|---|---|---|---|---|
| 0 strikes | Blue | Yellow | Green | Red |
| 1 strike | Red | Blue | Yellow | Green |
| 2 strikes | Yellow | Green | Blue | Red |

---

#### Module 5: Memory

Five sequential stages. Four buttons labelled 1–4 (positions left to right: 1–4). Incorrect press resets to stage 1. Track both the position pressed and the label on that button — later stages reference earlier results.

**Stage 1:**

| Display | Action |
|---|---|
| 1 | Press position **2** |
| 2 | Press position **2** |
| 3 | Press position **3** |
| 4 | Press position **4** |

*Remember: position pressed.*

**Stage 2:**

| Display | Action |
|---|---|
| 1 | Press label **"4"** |
| 2 | Press same position as stage 1 |
| 3 | Press position **1** |
| 4 | Press same position as stage 1 |

*Remember: position pressed.*

**Stage 3:**

| Display | Action |
|---|---|
| 1 | Press same label as stage 2 |
| 2 | Press same label as stage 1 |
| 3 | Press position **3** |
| 4 | Press label **"4"** |

*Remember: label on button pressed.*

**Stage 4:**

| Display | Action |
|---|---|
| 1 | Press same position as stage 1 |
| 2 | Press position **1** |
| 3 | Press same position as stage 2 |
| 4 | Press same position as stage 2 |

*Remember: position pressed.*

**Stage 5:**

| Display | Action |
|---|---|
| 1 | Press same label as stage 1 |
| 2 | Press same label as stage 2 |
| 3 | Press same label as stage 4 |
| 4 | Press same label as stage 3 |

---

#### Module 6: Morse Code

A flashing light transmits a word in Morse code (short flash = dot, long flash = dash; long gap between letters; very long gap before word repeats). Decode the full word, find its frequency, set the dial, and press TX.

| Word | Frequency | Word | Frequency |
|---|---|---|---|
| shell | 3.505 MHz | bistro | 3.552 MHz |
| halls | 3.515 MHz | flick | 3.555 MHz |
| slick | 3.522 MHz | bombs | 3.565 MHz |
| trick | 3.532 MHz | break | 3.572 MHz |
| boxes | 3.535 MHz | brick | 3.575 MHz |
| leaks | 3.542 MHz | steak | 3.582 MHz |
| strobe | 3.545 MHz | sting | 3.592 MHz |
| — | — | vector | 3.595 MHz |
| — | — | beats | 3.600 MHz |

---

#### Module 7: Complicated Wires

Each wire is evaluated independently. Each wire may have any combination of: red stripe, blue stripe, star symbol (★) below it, LED lit above it. Look up the combination to get a letter code; apply the corresponding cut rule.

**Cut codes:**

| Code | Rule |
|---|---|
| C | Cut the wire |
| D | Do not cut |
| S | Cut if last serial digit is **even** |
| P | Cut if bomb has a **parallel port** |
| B | Cut if bomb has **two or more batteries** |

**Attribute-to-code mapping** (4 attributes: Red, Blue, Star, LED):

| Red | Blue | Star | LED | Code |
|---|---|---|---|---|
| — | — | — | — | C |
| — | — | — | ✓ | C |
| — | — | ✓ | — | S |
| — | — | ✓ | ✓ | S |
| — | ✓ | — | — | S |
| — | ✓ | — | ✓ | D |
| — | ✓ | ✓ | — | B |
| — | ✓ | ✓ | ✓ | P |
| ✓ | — | — | — | C |
| ✓ | — | — | ✓ | B |
| ✓ | — | ✓ | — | S |
| ✓ | — | ✓ | ✓ | C |
| ✓ | ✓ | — | — | S |
| ✓ | ✓ | — | ✓ | D |
| ✓ | ✓ | ✓ | — | B |
| ✓ | ✓ | ✓ | ✓ | D |

> Implementation note: the manual presents this as a Venn diagram. The table above is a full truth table expansion. Authoritative source: manual p.13.

---

#### Module 8: Wire Sequences

Multiple panels of wires (up to 3 wires per panel), navigated with up/down buttons. Each wire connects a left number (1–3) to a right letter (A–C). Wire occurrences are cumulative across all panels. Cut the wire if it connects to the specified letter(s).

**Red wire cut conditions (by occurrence):**

| Occ. | Cut if connected to | Occ. | Cut if connected to |
|---|---|---|---|
| 1st | C | 6th | A or C |
| 2nd | B | 7th | A, B, or C |
| 3rd | A | 8th | A or B |
| 4th | A or C | 9th | B |
| 5th | B | | |

**Blue wire cut conditions:**

| Occ. | Cut if connected to | Occ. | Cut if connected to |
|---|---|---|---|
| 1st | B | 6th | B or C |
| 2nd | A or C | 7th | C |
| 3rd | B | 8th | A or C |
| 4th | A | 9th | A |
| 5th | B | | |

**Black wire cut conditions:**

| Occ. | Cut if connected to | Occ. | Cut if connected to |
|---|---|---|---|
| 1st | A, B, or C | 6th | B or C |
| 2nd | A or C | 7th | A or B |
| 3rd | B | 8th | C |
| 4th | A or C | 9th | C |
| 5th | B | | |

---

#### Module 9: Who's on First

Two steps.

**Step 1:** Based on the display word, determine which button position to read (the button whose label will be used in Step 2). The display-to-position mapping is visual — see manual p.9 for the authoritative grid. Position names: top-left, top-right, middle-left, middle-right, bottom-left, bottom-right.

**Step 2:** Using the label on that button, find the first button currently visible on the module that appears in that label's priority list below, and press it.

| Button label | Priority list (left to right — press first match found on module) |
|---|---|
| READY | YES, OKAY, WHAT, MIDDLE, LEFT, PRESS, RIGHT, BLANK, READY, NO, FIRST, UHHH, NOTHING, WAIT |
| FIRST | LEFT, OKAY, YES, MIDDLE, NO, RIGHT, NOTHING, UHHH, WAIT, READY, BLANK, WHAT, PRESS, FIRST |
| NO | BLANK, UHHH, WAIT, FIRST, WHAT, READY, RIGHT, YES, NOTHING, LEFT, PRESS, OKAY, NO, MIDDLE |
| BLANK | WAIT, RIGHT, OKAY, MIDDLE, BLANK, PRESS, READY, NOTHING, NO, WHAT, LEFT, UHHH, YES, FIRST |
| NOTHING | UHHH, RIGHT, OKAY, MIDDLE, YES, BLANK, NO, PRESS, LEFT, WHAT, WAIT, FIRST, NOTHING, READY |
| YES | OKAY, RIGHT, UHHH, MIDDLE, FIRST, WHAT, PRESS, READY, NOTHING, YES, LEFT, BLANK, NO, WAIT |
| WHAT | UHHH, WHAT, LEFT, NOTHING, READY, BLANK, MIDDLE, NO, OKAY, FIRST, WAIT, YES, PRESS, RIGHT |
| UHHH | READY, NOTHING, LEFT, WHAT, OKAY, YES, RIGHT, NO, PRESS, BLANK, UHHH, MIDDLE, WAIT, FIRST |
| LEFT | RIGHT, LEFT, FIRST, NO, MIDDLE, YES, BLANK, WHAT, UHHH, WAIT, PRESS, READY, OKAY, NOTHING |
| RIGHT | YES, NOTHING, READY, PRESS, NO, WAIT, WHAT, RIGHT, MIDDLE, LEFT, UHHH, BLANK, OKAY, FIRST |
| MIDDLE | BLANK, READY, OKAY, WHAT, NOTHING, PRESS, NO, WAIT, LEFT, MIDDLE, RIGHT, FIRST, UHHH, YES |
| OKAY | MIDDLE, NO, FIRST, YES, UHHH, NOTHING, WAIT, OKAY, LEFT, READY, BLANK, PRESS, WHAT, RIGHT |
| WAIT | UHHH, NO, BLANK, OKAY, YES, LEFT, FIRST, PRESS, WHAT, WAIT, NOTHING, READY, RIGHT, MIDDLE |
| PRESS | RIGHT, MIDDLE, YES, READY, PRESS, OKAY, NOTHING, UHHH, BLANK, LEFT, FIRST, WHAT, NO, WAIT |
| YOU | SURE, YOU ARE, YOUR, YOU'RE, NEXT, UH HUH, UR, HOLD, WHAT?, YOU, UH UH, LIKE, DONE, U |
| YOU ARE | YOUR, NEXT, LIKE, UH HUH, WHAT?, DONE, UH UH, HOLD, YOU, U, YOU'RE, SURE, UR, YOU ARE |
| YOUR | UH UH, YOU ARE, UH HUH, YOUR, NEXT, UR, SURE, U, YOU'RE, YOU, WHAT?, HOLD, LIKE, DONE |
| YOU'RE | YOU, YOU'RE, UR, NEXT, UH UH, YOU ARE, U, YOUR, WHAT?, UH HUH, SURE, DONE, LIKE, HOLD |
| UR | DONE, U, UR, UH HUH, WHAT?, SURE, YOUR, HOLD, YOU'RE, LIKE, NEXT, UH UH, YOU ARE, YOU |
| U | UH HUH, SURE, NEXT, WHAT?, YOU'RE, UR, UH UH, DONE, U, YOU, LIKE, HOLD, YOU ARE, YOUR |
| UH HUH | UH HUH, YOUR, YOU ARE, YOU, DONE, HOLD, UH UH, NEXT, SURE, LIKE, YOU'RE, UR, U, WHAT? |
| UH UH | UR, U, YOU ARE, YOU'RE, NEXT, UH UH, DONE, YOU, UH HUH, LIKE, YOUR, SURE, HOLD, WHAT? |
| WHAT? | YOU, HOLD, YOU'RE, YOUR, U, DONE, UH UH, LIKE, YOU ARE, UH HUH, UR, NEXT, WHAT?, SURE |
| DONE | SURE, UH HUH, NEXT, WHAT?, YOUR, UR, YOU'RE, HOLD, LIKE, YOU, U, YOU ARE, UH UH, DONE |
| NEXT | WHAT?, UH HUH, UH UH, YOUR, HOLD, SURE, NEXT, LIKE, DONE, YOU ARE, UR, YOU'RE, U, YOU |
| HOLD | YOU ARE, U, DONE, UH UH, YOU, UR, SURE, WHAT?, YOU'RE, NEXT, HOLD, UH HUH, YOUR, LIKE |
| SURE | YOU ARE, DONE, LIKE, YOU'RE, YOU, HOLD, UH HUH, UR, SURE, U, WHAT?, NEXT, YOUR, UH UH |
| LIKE | YOU'RE, NEXT, U, UR, HOLD, DONE, UH UH, WHAT?, UH HUH, YOU, LIKE, SURE, YOU ARE, YOUR |

---

#### Module 10: Passwords

Five columns of cycling letters (up/down buttons per column). Find the one combination that spells a word from the list and press SUBMIT.

**Valid words (35):**
about, after, again, below, could, every, first, found, great, house, large, learn, never, other, place, plant, point, right, small, sound, spell, still, study, their, there, these, thing, think, three, water, where, which, world, would, write

---

#### Module 11: Mazes

A grid with two circular markers identifying which of 9 maze layouts to use. Navigate the white light to the red triangle using arrow buttons. Walls are invisible on the bomb but shown in the manual.

> Implementation note: the 9 maze layouts are purely visual. Authoritative reference: manual p.15. Each maze is identified by the grid positions of its two circular markers.

---

### Controls and Input

**Defuser:**
- Mouse click on bomb module elements (wires, buttons, keypads, etc.)
- No keyboard required for module interaction
- Voice (browser microphone, mute toggle)

**Expert:**
- Mouse click to navigate digital manual (chapter selection, page scroll, table lookup)
- Voice (browser microphone, mute toggle)
- [If Asymmetric Expert Roles on] Manual navigation restricted to assigned chapters

**Facilitator:**
- Dashboard UI, mouse only
- Session configuration, team assignment, round control, retry trigger, spectator chat toggle

**Spectator:**
- Manual page viewing (read-only, locked to the active Expert's current page — see Assumption A3, resolved)
- Lifeline token spend (if enabled): select prompt from pre-defined list, confirm send
- No microphone access during active round (listen-only)

---

## Party Game Specific Design

### Module Variety

V1 ships 11 standard modules spanning three complexity tiers. See *Module Pool and Sequencing* in the Level Design section for the full gated list. Modules cover a range of communication challenges:

- **Colour and position description** — Wires, The Button, Wire Sequences, Complicated Wires
- **Symbol and spatial vocabulary** — Keypads, Mazes
- **Sequence and state tracking** — Simon Says, Memory
- **Verbal/language processing** — Who's on First, Passwords
- **Timing interpretation** — Morse Code

### Session Structure and Turn Flow

Relay race format. Five phases: Lobby → Preparation → Round loop → Between rounds → Session end. See *Core Gameplay Loop* for the full sequence.

**Rotation:** Defuse order is Facilitator-chosen; default is team join order. Every player defuses at least once before the session ends.

**Odd team sizes:** Shorter team plays one extra round (Facilitator assigns a volunteer Defuser) to equalise round count.

**Late join:** No mid-round joins. Between rounds, Facilitator can add a player before advancing. Late joiners may not defuse if relay slots are already assigned.

**Pause:** Facilitator can pause between rounds at any time. Mid-round pauses are triggered automatically on disconnect; Facilitator resumes manually.

**Retry:** Facilitator can offer a retry of a failed round (same layout, same values). Better of the two times is recorded.

### Scoring and Competition

- Time-based scoring: lowest cumulative defuse time across all rounds wins.
- No points for individual module solves.
- Failed rounds contribute time at the moment of failure.
- Round-by-round breakdown displayed on the end-of-session scoreboard.
- No persistent leaderboards in V1.

### Remote Multiplayer UX

**Voice channels (LiveKit WebRTC):**
- *Bomb Room* — Defuser, Experts, Facilitator (full bidirectional audio)
- *Spectator Lounge* — Spectators (listen-only to Bomb Room; cannot broadcast)

**Speaker indicator** — visual display of who is currently speaking.

**Mute controls** — per-player mute/unmute.

**Join flow** — Facilitator shares a session link and join code (Jackbox-style). No account creation. Browser-only.

### Accessibility and Skill Range

- **Skill floor:** A first-time team can defuse a 3-module Easy bomb (Wires, Button, Passwords) without prior knowledge. Rules are learnable from the manual during the Preparation phase.
- **Skill ceiling:** Hard difficulty + Asymmetric Expert Roles + 7–9 modules demands fluent team coordination across all 11 module types simultaneously.
- **Colorblind consideration:** [NOTE FOR DESIGNER: Wires, The Button, Simon Says, and Complicated Wires all use colour as a primary descriptor. Colorblind-accessible visual treatment (patterns, labels) should be designed before v1 release.]
- **No handicap system** in V1. Difficulty settings serve as the primary skill-range accommodation.

### Session Length

| Session type | Approximate duration |
|---|---|
| 2-player pair | 20–30 min |
| Standard team (4–8 players) | 45–60 min |
| Full event (12–16 players) | 75–90 min |

Target round length: 3–5 minutes. [ASSUMPTION: timer values require playtesting validation before release.]

Drop-in/drop-out: not supported mid-session. Players must be present at session start. Disconnect during a round triggers a pause; Facilitator resolves.

---

## Progression and Balance

### Difficulty System

Difficulty controls three parameters simultaneously:

| Parameter | Easy | Medium | Hard |
|---|---|---|---|
| Module pool | Wires, Button, Passwords | + Keypads, Who's on First, Wire Sequences, Mazes | + Complicated Wires, Simon Says, Memory, Morse Code |
| Default module count | 3–4 | 5–6 | 7–9 |
| Placeholder timer | 5 min | 6 min | 7 min |

[ASSUMPTION: timer values are placeholders pending playtesting. Target: median round completes in 3–5 minutes.]

Facilitator can override both module count and module pool regardless of difficulty setting.

### Bomb Configuration

- **Module count:** 3–11, Facilitator-configured. Difficulty provides recommended default range.
- **Timer:** Configurable. Difficulty provides recommended default. Timer speeds up after each strike (0–50% per strike, configurable; default 25%, compounding).
- **Module pool:** Hybrid. Difficulty gates the pool; Facilitator can add or remove specific modules.
- **Value randomisation:** Wire colours, button labels, keypad symbols, Simon sequences, Memory display numbers, Morse words — all independently randomised per team per round. Seeded for determinism and fairness (identical module types, independent values).

### Balance Targets

[ASSUMPTION: all per-module targets are estimates pending playtesting.]

| Module | Target solve time (experienced team) |
|---|---|
| Wires | 30–60 s |
| The Button | 20–40 s |
| Passwords | 45–90 s |
| Keypads | 60–120 s |
| Who's on First | 60–90 s |
| Wire Sequences | 60–120 s |
| Mazes | 60–120 s |
| Complicated Wires | 60–120 s |
| Simon Says | 90–150 s |
| Memory | 120–180 s |
| Morse Code | 90–150 s |

---

## Level Design Framework

### Bomb Layout Design

A "level" in Bomb Squad is a bomb configuration: module count, module types (layout), and randomised values. Two teams play identical layouts with independent values.

**Bomb metadata** (displayed on casing, used in module rules):
- Serial number: alphanumeric, randomised. Last digit odd/even and vowel presence affect module rules.
- Batteries: count randomised within a range per difficulty.
- Indicators: subset of {SND, CLR, CAR, IND, FRQ, SIG, NSA, MSA, TRN, BOB, FRK}, lit/unlit randomised.
- Ports: subset of {DVI-D, Parallel, PS/2, RJ-45, Serial, Stereo RCA}, randomised.

### Module Pool and Sequencing

V1 includes all 11 standard modules from the KTANE manual v1. Availability gated by difficulty; Facilitator can override.

| Tier | Modules |
|---|---|
| Easy | Wires, The Button, Passwords |
| Medium | + Keypads, Who's on First, Wire Sequences, Mazes |
| Hard | + Complicated Wires, Simon Says, Memory, Morse Code |

**Needy modules** (Venting Gas, Capacitor Discharge, Knobs) are deferred to V2. The bomb renderer, module state machine, and Defuser UI must be designed to support needy modules with additive changes only — no structural rewrite.

**V2 scope:** Research and integrate existing community-created custom modules.

---

## Art and Audio Direction

### Art Style

**Aesthetic:** Stylised bomb — chunky, retro-industrial, slightly absurd. 1960s spy-thriller prop aesthetic. Not realistic military hardware; not cartoonish. Visual reference: *Keep Talking and Nobody Explodes* module language.

**3D rendering:** Real-time 3D bomb displayed in-browser. Flat/stylised materials — bold colours, thick outlines, readable at a glance under time pressure. No photorealism. Grounded and stylised — not cartoonish, not realistic military hardware. Target 60 fps on a mid-range laptop in a conference room.

**Module design principle:** Every module must be describable in plain language by a first-time player under 60 seconds of time pressure. If a visual element requires a shared vocabulary that players don't naturally have (e.g., Keypad symbols), the module must visually reinforce the closest natural description.

**UI:** Minimal. Timer and strike counter are always visible to the Defuser. Manual viewer is clean and scannable — tables must be legible at a glance.

### Audio Design

| Event | Sound |
|---|---|
| Active defusal | Ticking countdown (tempo increases with strike escalation) |
| Module solved | Solve chime |
| Strike recorded | Strike sound |
| Bomb explosion | Explosion |
| Bomb defused | Defuse fanfare |
| Lobby | Light ambient sound |
| Active round | No music — **the team's voice is the soundtrack** (design principle, not an omission) |

All SFX only, no music during rounds. Audio is minimal and purposeful; every sound communicates a game state.

---

## Technical Specifications

### Performance Requirements

- 60 fps sustained on mid-range laptop in a conference room (measured over a 10-minute active session)
- Bomb state sync latency ≤ 100 ms across all clients
- WebRTC voice connects within 10 seconds behind corporate firewalls (symmetric NAT scenario)
- Session supports 2–16 simultaneous browser clients

### Platform Requirements

| Browser | Support level |
|---|---|
| Chrome 90+ | Primary |
| Firefox 88+ | Primary |
| Edge 90+ | Primary |
| Safari | Secondary (supported, not primary test target) |

No mobile app in V1. No Electron. Browser-only.

**Deployment:** Self-hosted Docker Compose. LiveKit Server + coturn (TURN) + Caddy/Nginx.

### Architecture Constraints

- **Server-authoritative state:** All game state is determined by the server. Client inputs are events; the server is the single source of truth.
- **Deterministic randomisation:** All bomb value generation is seeded. Given the same seed and bomb context, generation is reproducible — enabling per-team independent randomisation with fairness guarantees.
- **60 fps enforced from day one:** Performance is a development gate at every stage, not a polish task. Any feature that cannot maintain 60 fps on reference hardware is not shipped.
- **WebRTC reliability:** Test behind symmetric NAT before the first internal event. Document TURN port requirements as part of the deployment guide.
- **Needy module readiness:** Bomb layout, module state model, and Defuser UI must be designed so that V2 needy module support requires only additive changes — no structural rewrite.

> Implementation specifics (state management patterns, database selection, infrastructure libraries, internal code-quality rules) belong in the architecture document, not the GDD.

### Asset Budgets

[ASSUMPTION: asset budgets to be defined during architecture phase based on 60 fps performance target on reference hardware.]

---

## Development Epics

*See epics.md for detailed epic and story breakdown.*

| # | Epic | Description |
|---|---|---|
| 1 | Foundation | Monorepo setup, shared types, server infrastructure, Docker Compose |
| 2 | Lobby & Session | Session creation, join flow, team assignment, Facilitator dashboard |
| 3 | Voice | LiveKit WebRTC integration, Bomb Room + Spectator Lounge channels |
| 4 | Bomb Renderer | React Three Fiber 3D bomb, module layout, timer, strike counter |
| 5 | Core Modules (Easy) | Wires, The Button, Passwords — full defusal logic + manual pages |
| 6 | Core Modules (Medium) | Keypads, Who's on First, Wire Sequences, Mazes |
| 7 | Core Modules (Hard) | Complicated Wires, Simon Says, Memory, Morse Code |
| 8 | Game Loop | Relay race format, round flow, scoring, scoreboard, odd-team handling |
| 9 | Advanced Features | Asymmetric Expert Roles, Spectator Lifelines |
| 10 | Polish & Hardening | SFX, visual polish, 60 fps optimisation, WebRTC reliability, playtesting |

---

## Success Metrics

### Technical Metrics

| Metric | Target |
|---|---|
| Sustained fps (mid-range laptop, conference room) | ≥ 60 fps |
| WebRTC connection success rate (behind corporate firewalls) | ≥ 95% |
| Bomb state sync latency | ≤ 100 ms |
| Session crash / desync rate | ≤ 1% |
| Facilitator setup time (session creation to first round started) | ≤ 3 min |

### Gameplay Metrics

| Metric | Target |
|---|---|
| First-time module defusal rate (% of first-time teams that defuse ≥1 module in round 1) | ≥ 90% |
| Session completion rate (% of sessions reaching the final scoreboard) | ≥ 85% |
| Median round time | Within 3–5 min target |
| 30-day team retention | ≥ 40% |
| Sessions per team per month | ≥ 2 |
| Asymmetric Expert Roles adoption (teams with ≥3 sessions played) | Track only |

---

## Out of Scope

**V1 exclusions:**
- Needy modules (Venting Gas, Capacitor Discharge, Knobs) — deferred to V2; architecture must support additive addition
- Hot Seat Rotation mode — deferred to post-launch
- Custom module authoring — deferred to post-launch / open source
- Session recording and replay — no persistent user identity to attach replays to; out of scope for a contained internal ritual tool
- Persistent leaderboards — no persistent accounts in V1
- Mobile-optimised layouts — conference room / desk use case; mobile browser not a V1 requirement
- Parallel defuse (both teams playing simultaneously) — deferred; sequential relay keeps spectators focused on one bomb and avoids a broadcast synchronisation layer
- Video feeds — deferred to post-launch; voice is sufficient for the communication mechanic
- Internationalization — English only in V1

**Post-launch / open source:**
- Hot Seat Rotation mode
- Video feed integration
- Additional module packs
- Custom module authoring
- Community custom modules (V2 research)

---

## Assumptions and Dependencies

| # | Assumption | Impact if wrong |
|---|---|---|
| A1 | Round timer placeholder values (Easy 5 min, Medium 6 min, Hard 7 min) are validated through playtesting before release | Timer values adjusted; balance targets revisited |
| A2 | Per-module solve time estimates are representative of an experienced team | Balance targets and difficulty tier assignments may shift |
| A3 | ~~Spectator manual view is free-navigate~~ → **RESOLVED 2026-06-10: spectator manual is LOCKED, mirrors the active Expert's current page** (most-recently-navigated Expert when multiple). Adds a requirement to broadcast Expert page position to the Spectator Lounge. | Resolved — locked-mirror chosen |
| A4 | WebRTC (LiveKit + coturn) reliably connects behind symmetric NAT in corporate environments — must be tested before first internal event; TURN port requirements must be documented | Primary delivery mechanism fails; requires fallback communication strategy |
| A5 | 60 fps is achievable on a mid-range laptop with 11 rendered 3D modules | Performance budget requires simplification of 3D assets or module count cap |
| A6 | All module visual elements are describable in plain language by a first-time player under time pressure — validate by user-testing each module with naive players under time pressure before release | User testing may require module visual redesign before release |
| A7 | Identical module types with independently randomised values produces equivalent difficulty for both teams | Specific value combinations (e.g. rare Morse words, difficult Memory sequences) may create unfair variance — flag for playtesting |
| A8 | Lifeline overlay duration of 8 seconds is legible and non-disruptive during active defusal | Duration adjusted up or down based on playtesting |
| A9 | Preparation phase default of 2–5 minutes is sufficient for a first-time team to orient to the manual | Duration may need adjustment based on playtesting with inexperienced teams |

**Dependencies:**
- LiveKit Server (self-hosted)
- coturn TURN server
- Redis (in-flight state)
- PostgreSQL (session end persistence)
- React Three Fiber (3D bomb rendering)
- KTANE Bomb Defusal Manual v1 (authoritative rule source for all 11 modules)
