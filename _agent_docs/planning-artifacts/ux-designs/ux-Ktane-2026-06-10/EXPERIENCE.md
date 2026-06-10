---
name: Bomb Squad — Experience Design
project: Ktane
status: final
updated: 2026-06-10
peer: ./DESIGN.md
sources:
  - ../../briefs/brief-Ktane-2026-06-09/brief.md
  - ../../gdds/gdd-Ktane-2026-06-09/gdd.md
  - ../../../project-context.md
---

# Bomb Squad — Experience Design

DESIGN.md is the visual identity peer. Visual specs (colors, type, component appearance) live there; this document owns behavior, flow, and information architecture. Tokens are referenced as `{path.to.token}` against DESIGN.md frontmatter. Both spines win on conflict with any mock or import.

## Foundation

- **Form-factor:** desktop web browser only in V1. Chrome 90+, Firefox 88+, Edge 90+ primary; Safari secondary. No mobile optimization, no native, no VR.
- **Engine / UI system:** React 18 + React Three Fiber (R3F) for the 3D bomb scene; React + Tailwind for non-diegetic UI; Zustand for client state; Socket.IO + LiveKit for real-time game and voice. EXPERIENCE.md specifies behavior only — rendering primitives inherit from R3F and Tailwind.
- **Authority model:** server-authoritative for all game state. Client renders; never simulates. Bomb timer is the server's clock.
- **Stakes:** internal team-building tool, hobby tier. No commercial UX polish budget; **functional clarity over decoration**, every time.

## Information Architecture

Top-level surfaces, in player-encounter order:

1. **Landing / Join** — enter join code (Defuser/Expert/Spectator) *or* "Host a session" (Facilitator).
2. **Lobby** — show team roster, role pickers, join-code share, "Ready" state, voice mic-check.
3. **Preparation phase** — all players in same view, but role-gated content: Defuser sees module *types only* on a placeholder bomb; Experts and Spectators browse the full manual.
4. **Active round (role-dependent):**
   - **Defuser:** Bomb View.
   - **Expert:** Manual Viewer.
   - **Spectator:** Spectator Lounge (split-pane Bomb + current manual page).
   - **Facilitator:** Facilitator Dashboard.
5. **Between-round** — scoreboard preview + ready gate for next round.
6. **End-of-session** — final scoreboard, debrief.

**Role gating principle:** the same URL/session shows different surfaces by role. Roles never see each other's primary surface — that information asymmetry *is* the game.

### HUD information hierarchy (Bomb View)

Rank-ordered by glance priority:

1. **Timer** — top-center, loudest element. (`{components.timer}`)
2. **Strike indicator** — adjacent right of timer, 2 LED dots. (`{components.strikeIndicator}`)
3. **Module solve LEDs** — *on the bomb chassis itself*, not in the HUD overlay. (`{components.moduleSolveLed}`)
4. **Active speaker pill** — top-left, never overlapping timer. (`{components.speakerIndicator}`)
5. **Self mic / mute control** — bottom-left, always reachable.
6. **Pause / disconnect banner** — full-width top strip, only when active.

Nothing else lives in the HUD. Lifeline overlays are toasts, not HUD elements. Scoreboard never appears mid-round.

## Voice and Tone

Microcopy is **dry, deadpan, period-appropriate**. The bomb is serious; the framing is not.

- Timer labels: "T-MINUS" not "Time Left."
- Round result: "DEFUSED." / "DETONATED." / "TIME EXPIRED." — all-caps, terminal punctuation.
- Strike toast: "Strike. Don't do that again." (one only; second strike is silent because the timer speed-up speaks for itself.)
- Lifeline arrival: "Spectator [name] sent a tip: [tip]."
- Join code share: "Bring them in" (not "Invite Players").
- Facilitator pause: "Holding the clock."

Brand voice direction lives in `DESIGN.md > Brand & Style`; this section governs only the words.

## Component Patterns (behavioral)

Visual specs in DESIGN.md. Behavior here:

- **Primary button** — tactile press (translateY 2px). All destructive/irreversible actions get a secondary confirm step (e.g., "End session?"). No primary button is ever a destructive action.
- **Join-code input** — 6 character cells, mono type. Auto-uppercases. Pastes split per-cell. Submits on 6th char without explicit button press.
- **Module solve LED** — green-glow on solve is the *only* solved confirmation the Defuser gets visually. Pair with an audio solve chime so it lands without staring.
- **Speaker indicator** — pulses while the participant transmits, with a 150ms grace to suppress flicker on stop. Names always shown; never icon-only (colorblind floor + identity clarity).
- **Toast** — non-blocking, stacks vertically top-right, max 3 visible. Lifeline toast persists 8s; standard toast 5s. Never animates the bomb scene's layout.
- **Manual page** — keyboard arrows + Page Up/Down navigate. Current chapter highlighted in sidebar. Scroll position is per-chapter persistent (Expert flipping back and forth never loses their place).
- **Bomb chassis (R3F)** — Defuser orbits/zooms with mouse-drag and scroll. Right-click and middle-click reserved (no module interaction on those). Click on a module focuses it (camera dollies in); ESC returns to bomb overview.

## State Patterns

- **Loading / connecting** — full-bleed screen with spinner + status line ("Connecting to Bomb Room…"). Never block UI behind a silent network call.
- **Voice connecting** — separate microcopy from socket connecting; voice failure must not block game UI ("Voice unavailable — game continues without it").
- **Paused (disconnect)** — full-width top strip, amber, names who dropped. Bomb scene dims; timer freezes. Resume requires facilitator click + all players ready.
- **Strike** — module flashes red 600ms, strike LED activates, timer speed updates. No modal interruption.
- **Solve** — module LED flips green; audio chime; +1 to solve count.
- **Defused** — all LEDs green, scene holds 2s, transitions to between-round.
- **Detonated** — explosion SFX, scene tint red, 3s hold, transitions to between-round. No replay/freeze frame in V1.
- **Empty states** — lobby with 1 player: "Waiting for your team." Facilitator dashboard with no session: "Configure round 1 to begin."
- **Error states** — connection lost: blocking modal with retry; voice lost: dismissible banner.

## Interaction Primitives

- **Click (Defuser):** sole module interaction primitive. Wire cut = click. Button press = mousedown+mouseup. Button hold = mousedown, sustain, mouseup. Keypad symbol = click. Maze = click adjacent cell. Memory = click numbered position. Morse Code = click TX button.
- **Drag (Defuser):** orbit camera only. Never used to drag modules or wires.
- **Scroll (Defuser):** zoom camera.
- **Click (Expert):** chapter selection, page links.
- **Keyboard (Expert):** arrow keys page-flip; `/` opens chapter search (search-by-name).
- **Voice (everyone):** push-to-talk default off (open mic by default in V1 — the room is small). PTT toggle in settings.
- **No keyboard shortcuts on the bomb side** in V1 — mouse-only, voice-instructed. Adding shortcuts would let the Defuser self-coach.

## Accessibility Floor

Behavioral; visual contrast is governed by DESIGN.md tokens.

- **Colorblind:** modules Wires, The Button, Simon Says, Complicated Wires *must* carry pattern or label redundancy before V1 release. Track as a gate, not a polish item.
- **Focus order:** all non-bomb UI keyboard-traversable. Focus ring uses `{colors.ui.focus}` (LED green) at 2px outline + 2px offset.
- **Reduced motion:** respect `prefers-reduced-motion`. Disable timer glow pulse, speaker indicator pulse, strike flash → swap for instant state changes. Solve chime still plays.
- **Caption / screen reader:** out of scope V1 (voice-first co-op). Document explicitly so future contributors don't ship blind.
- **Motor:** no rapid-input modules. Maximum cadence demand is Morse Code transcription (paced by the bomb, not the player).
- **Voice failure path:** game must remain playable if voice drops — Defuser and Expert can still play, even if poorly. The game does not depend on the voice layer working perfectly.

## HUD & Diegetic UI

A first-class decision for this game.

**Diegetic** — lives *on the bomb*:
- Bomb timer LCD (built into the chassis).
- Strike indicator LEDs (on the chassis face).
- Per-module solve LEDs (on each module).
- Serial number sticker, battery count panel, indicator labels — all physical chassis features.

**Non-diegetic** — overlays floating in screen space:
- Active speaker pill.
- Self mute control.
- Pause / disconnect banner.
- Toasts (strike, lifeline, system).
- Round-end transition overlays.

**Why split this way:** the Defuser's mental model is "I'm holding a bomb." Game-state cues that belong to the bomb (timer, strikes, solves) sit on the bomb so they're describable to the Expert with physical language ("the timer says 2:14"). Communication cues (who's talking, am I muted) are inherently meta-game and belong to the operator overlay.

**Things that *fade or hide* during active play:**
- Lobby chrome, role pickers, ready buttons — gone.
- Facilitator's pause control fades to 20% opacity until hovered (it's a "break-glass" affordance).
- Cursor hides on the bomb scene after 2s of mouse idle.

## Input Schemes

Single scheme in V1: **mouse + keyboard + microphone, desktop browser.**

- Mouse: primary input.
- Keyboard: manual navigation, focus traversal, ESC for camera reset.
- Microphone: voice. No PTT default; PTT optional in settings.
- **No controller, touch, motion, or VR support.** Document so it's a deliberate omission, not an oversight.

Button glyph adaptation is not a concern (no controller). Future V2 if mobile/controller arrives, this section expands.

## Game Feel & Juice

Felt responsiveness of UI under voice-driven stress.

- **Click → outcome latency budget: ≤100ms** (perceptual instant). Includes Socket.IO round-trip; the optimistic-render path may pre-flash the affordance and roll back on server rejection (but never pre-commits to "solved" — only the server says solved).
- **Solve chime** — distinct pitch per module type so the Expert can hear which module just solved through voice chatter.
- **Strike sound** — short, declarative, slightly absurd ("klaxon honk," not a screaming alarm).
- **Timer tick** — present but quiet; gets louder under 30s remaining, louder still under 10s. No visual flicker until under 10s, when LCD glow pulses on the second.
- **Explosion** — generous: full-screen flash, low-frequency bass drop, 1.5s of silence after, then results. The room should *feel* it.
- **Defuse fanfare** — three-note brass motif, period-appropriate. The single most rewarding sound in the game; spend the budget here.
- **No screen shake** — the Defuser is already mouse-precision-clicking under stress; shake is hostile.
- **Haptics** — N/A (browser, no controller).
- **Reduce-motion respect** — see Accessibility Floor.

## Inspiration & Anti-patterns

**Inspiration**
- Keep Talking and Nobody Explodes — gold standard for module language.
- Mid-century industrial design (Braun, Bakelite radios) for chassis material vocabulary.
- Arcade 7-segment displays for diegetic readouts.

**Anti-patterns to avoid**
- Modern flat-design SaaS — would dissolve the "physical object" illusion.
- Realistic military / tactical aesthetic — wrong tone (this is comedic team-building, not Six Days in Fallujah).
- Tutorial overlays that mid-round explain mechanics — Experts explain mechanics; that's the game.
- Achievement popups, XP, level-ups — out of scope and tonally wrong.
- Music — explicitly excluded (carried from GDD).
- Mid-round chat — coaching risk; spectator chat visibility is facilitator-controlled.

## Responsive & Platform

- **Target viewport range:** 1280×720 minimum, 1920×1080 design baseline, up to 4K.
- **Below 1280×720:** show a "Resize your window — Bomb Squad needs more room" gate. Not a responsive design problem; a gameplay-clarity problem.
- **Aspect ratios:** 16:9 design baseline; 16:10 and 21:9 supported (bomb scene letterboxes vertically, never crops the chassis).
- **Mobile:** not supported V1. Show a friendly bounce screen: "Bomb Squad is a desktop experience."
- **Pixel density:** R3F handles DPR; UI uses standard responsive units. Test on 1× and 2× displays before release.

## Key Flows

Four named-protagonist player journeys. Names are `[ASSUMPTION]` — flag to Jay; mirror GDD-defined names verbatim if/when those land.

### Flow 1 — Maya Defuses Her First Module (climax: the cut)

Maya, a backend engineer joining her first Bomb Squad session, has just been assigned Defuser. The bomb appeared 4 seconds ago.

1. **Orient.** Maya drags to orbit the bomb. The 3D chassis reads as a physical object — Bakelite orange, brass screws, six modules visible across two faces. Timer reads 5:00. Zero strikes.
2. **Describe.** She says "OK I see four wires on the front — red, white, blue, red." Devon (Expert) flips manual to Wires.
3. **Listen.** Devon reads the rule: "If there are no red wires, cut the second. Otherwise..." Maya squints. "Two reds. What's the serial?"
4. **Find serial.** She rotates the bomb, finds the serial sticker on the back. "Reads K-T-A-N-E-5." Mono font, clearly legible at zoom.
5. **Resolve rule.** Devon: "Last digit's odd — cut the last red wire."
6. **Climax — the cut.** Maya hovers over the second red wire. Pause. She clicks. The wire animates severed; module solve LED flips from dim red to bright green; solve chime plays (Wires-specific pitch). Strike indicator stays at zero. Maya exhales.
7. **Continue.** "OK what's next" — camera ESCs back to overview. Five more modules; 4:48 remains.

**UX claims this flow makes:**
- The serial number must be findable in <10s by rotating the bomb. No menu-driven inspection of the serial.
- The solve LED + chime together deliver the success signal — both required because Maya may be looking at a wire, not the LED, at the moment of solve.
- "Wires-specific pitch" implies module-typed chime pitches — call out for audio design.

### Flow 2 — Devon, Expert, Asymmetric Manual Split

Devon is paired with Maya. In a previous session they ran symmetric (both experts saw all chapters); tonight Priya enabled Asymmetric Expert Roles — Devon owns chapters 1–6, Devon's teammate Ana owns 7–11.

1. **Receive bomb.** Bomb shows on Spectator-style preview during prep (read-only). Devon scans modules: "We've got Wires, Button, and a Keypad on my side; Simon, Memory, Morse on Ana's."
2. **Page through.** Devon arrow-keys to Chapter 2 (The Button). Manual page renders in serif, on cream paper, with the Button decision table dominant. Scroll position remembered when he flips to Chapter 1 and back.
3. **Coordinate.** "Maya describe what you see on the Button." She does. Devon walks the table aloud.
4. **Hand off.** Maya: "OK I'm hitting Simon next." Devon: "Ana, your call." Manual surface for Ana lights her chapter sidebar; Devon stays on Button until needed again.
5. **Climax — chapter search.** Strike 1 just fired on Memory. Ana freezes. Devon hits `/`, types "memory," jumps to Chapter 10, reads the reset rule. "She just reset to stage 1 — Ana, recalibrate."

**UX claims:**
- Manual chapter search is keyboard-first; <300ms to "Chapter 10 visible" from `/` keypress.
- The manual must let an Expert read calmly while the bomb is screaming — that's why the serif typeface and paper texture matter behaviorally, not just aesthetically.

### Flow 3 — Priya Runs an 8-Player Session

Priya, design lead, is facilitating Friday team-building. Two teams of 4. She's never been a Facilitator before.

1. **Configure.** Dashboard step 1: "Round 1 settings." She picks Easy tier, 5:00 timer, 3 modules. Picks "Asymmetric Expert" toggle off for round 1 (kindness to first-timers).
2. **Assign teams.** Eight names land in the lobby; she drags four to Team A, four to Team B. Within each team, she selects roles: 1 Defuser, 2 Experts, 1 Spectator.
3. **Mic check.** Each player shows a green speaker dot when they say hello. One player's dot stays gray. Priya pings: "Sam, can you check your mic?"
4. **Start.** "Round 1 begin." Both teams enter prep simultaneously (sequential play, not parallel — the other team watches as spectators with chat-visibility off).
5. **Climax — mid-round retry.** Team A detonates at 1:20. Priya considers; round 1 should feel learnable. She clicks "Retry round 1 (Team A)." Toast confirms; Team A re-enters prep with a fresh seed. Team B watches a "Team A is regrouping" placeholder.

**UX claims:**
- The dashboard must read calmly under "8 humans waiting for me" social pressure. No fast-blinking elements, no nested modals.
- "Retry round" is a single click with a single confirm — not a settings menu dive.
- Spectator chat visibility default = off for first session; Priya can toggle on for round 3+ once teams find their rhythm.

### Flow 4 — Sam, Spectator, Lifeline Decision

Sam was Defuser in round 2 and detonated at 0:14. In round 3, he's Spectator. He holds 1 lifeline token.

1. **Enter lounge.** Spectator Lounge view: bomb scene left, current Expert manual page right. Listen-only voice — he hears the Bomb Room but cannot speak in. Chat is off (Priya's call).
2. **Watch.** He sees Team A on Simon Says. Maya is pressing wrong colors. He winces.
3. **Knows the answer.** He just played Simon last round — he knows the vowel-rule pivot point.
4. **Climax — the token.** Lifeline button glows in the lounge HUD. Pre-defined tip list (8 options); he picks "Check serial number for vowels — flips the color table." Confirm modal: "Send this tip? You have 0 tokens after."
5. **Send.** A toast appears in the Bomb Room: "Spectator Sam sent a tip: Check serial number for vowels — flips the color table." 8-second persistence (per GDD A8). Maya reads it aloud. Module solves.
6. **Aftermath.** Sam's token counter shows 0. He still watches, voiceless and tokenless, until round 4.

**UX claims:**
- Lifeline tip arrival is a toast, not a modal — it must not interrupt the Defuser mid-click.
- The pre-defined tip list is small enough to scan in 5s (≤8 items). Free-text would create coaching exploits.
- Spectator chat visibility toggle (per GDD) is a separate concern from the lifeline mechanic — both can be active or off independently.

---

## Open items

- `[ASSUMPTION]` Player-journey protagonists invented — confirm or replace.
- `[ASSUMPTION]` Aesthetic direction (DESIGN.md) — confirm or pivot before Claude Design handoff.
- `[NOTE FOR UX]` Module-typed solve-chime pitches need audio direction at architecture phase.
- `[NOTE FOR UX]` Spectator manual view: locked-to-Expert vs free-navigate default (GDD A3 open).
