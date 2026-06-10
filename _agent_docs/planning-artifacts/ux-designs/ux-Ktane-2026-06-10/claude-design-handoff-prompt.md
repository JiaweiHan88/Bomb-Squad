# Claude Design Handoff Prompt — Bomb Squad

Paste the block below into Claude Design (or any UI-mock-producing tool). Attach `DESIGN.md` and `EXPERIENCE.md` from this folder as context. Save the tool's output back into this run folder (e.g., `mockups/` for HTML, `imports/` for image/Figma exports).

---

## Prompt

You are designing high-fidelity UI mockups for **Bomb Squad**, a desktop-browser co-op puzzle game played by internal teams (2–16 players, 45–90 min sessions). It's a Keep Talking and Nobody Explodes-style game: one player ("Defuser") sees a 3D bomb and clicks on it; the others ("Experts") read a digital manual and give voice instructions; optional Spectators watch a split-pane view; a Facilitator runs the session.

Two spine documents define the design and behavior — they are the ground truth and win any conflict with your output:

- **DESIGN.md** — visual identity (colors, typography, components, do's and don'ts). Read the frontmatter tokens; honor them exactly.
- **EXPERIENCE.md** — IA, HUD, flows, accessibility, game feel. Read sections "Information Architecture," "HUD & Diegetic UI," and "Key Flows" before drawing.

### Aesthetic in one sentence

A chunky, slightly-absurd 1960s spy-thriller prop bomb on a steel workbench — Bakelite orange chassis, brass screws, LED reds and greens, 7-segment LCD timer; the operator UI is a dark app shell, and the Expert's manual reads as printed cream paper with a serif typeface.

### What to produce

Mock these **eight key screens** as high-fidelity HTML (1920×1080 baseline, responsive down to 1280×720). Use the DESIGN.md token values directly as CSS variables — don't invent your own palette.

1. **Landing / Join Screen** — single centered card. Big "Bomb Squad" wordmark in display typeface. Two paths: "Enter a join code" (6-cell mono input) and "Host a session" (secondary button). Mic-permission preflight microcopy in body type. Dark surface (`{colors.ui.surface}`).

2. **Lobby** — left: team roster cards (avatar dot, name, role badge, mic-check green/gray dot). Right: join-code share with copy button + QR; bottom-right: "Ready" primary button. Dark operator-world palette. Up to 16 player slots; show the empty-state at 1 player ("Waiting for your team.").

3. **Defuser — Bomb View (the hero screen)** — full-bleed dark workbench background; the 3D bomb is the canvas. Overlay HUD per EXPERIENCE.md HUD hierarchy:
   - Top-center: LCD timer reading `4:32`, slight red glow.
   - Right of timer: 2-LED strike indicator, both dim red (zero strikes).
   - Top-left: active speaker pill ("Devon" with LED-green pulse ring).
   - Bottom-left: self-mute toggle ("You" with cool-blue ring).
   - Bomb itself shows 6 visible modules across the front face (Wires, The Button, Keypad, Simon Says, Memory, Morse Code). Each module has its own solve LED on the chassis. The chassis carries a serial number sticker ("KTANE5") and indicator labels ("FRK", "CAR" in mono type).
   - No menu chrome. Cursor visible.

4. **Expert — Manual Viewer** — two-column layout. Left sidebar (240px): chapter list, 1–11, current chapter highlighted, serif typeface. Right pane: the manual page itself on cream paper (`{components.panel.manualPage}`), with subtle paper grain, a chapter heading in serif, body text in serif, and an embedded rule table (e.g., for "Wires"). Bottom of page: page navigation hint ("← prev  /  next →"). The whole pane should feel like a sheet of paper sitting on a dark desk — paper shadow visible, max 1° rotation.

5. **Spectator Lounge** — split-pane: left 60% is a *read-only* miniaturized Bomb View (smaller HUD, no interaction affordances); right 40% is the Expert's *current* manual page (same paper treatment, locked to whatever page the Experts are on). Top-right: lifeline token counter ("1 token") and a "Send Tip" button. Listen-only mic indicator (headphones glyph, not microphone).

6. **Facilitator Dashboard** — single-page operator console, dark surface. Three sections: (a) "Round Configuration" — tier picker (Easy/Medium/Hard), timer slider, module count, Asymmetric Expert toggle; (b) "Teams" — drag-assignable player list into Team A / Team B slots with role pickers; (c) "Round Control" — Start/Pause/Retry buttons; spectator-chat-visibility toggle; current round status. No bomb chassis vocabulary here — operator world only. Calm, no fast-blinking elements.

7. **Strike Toast + Lifeline Toast (variants on Bomb View)** — same screen as #3 but show two toast variants stacked top-right: a strike toast ("Strike. Don't do that again.") in red, and a lifeline toast ("Spectator Sam sent a tip: Check serial number for vowels — flips the color table.") in cream/Bakelite, with an 8-second progress indicator. Both non-blocking; bomb still interactive behind them.

8. **End-of-Session Scoreboard** — full-screen take-over. Display typeface headline: "DEFUSED." or "DETONATED." (show one). Below: per-round times for both teams, winner badge, "Bring them back" (rematch) and "End session" buttons. Bakelite-orange + cream + dark surface; no LED-green/red except for round-result iconography.

### Non-negotiable rules (carry from DESIGN.md "Do's and Don'ts")

- **LED-green = solved; LED-red = strike/error; LED-amber = caution; cool-blue = self.** Never use these colors decoratively.
- **Three depth tiers only:** in-world 3D bomb / flat HUD overlays / modals (or the manual paper). No floating cards in mid-tier.
- **Serif typeface + cream paper = manual.** This is the strongest cue that "you're reading rules, not playing the game." Don't use serif anywhere else; don't use cream backgrounds anywhere else.
- **The timer is the loudest element** on the Bomb View. If anything else competes for attention, the HUD is wrong.
- **No music, no screen shake, no achievement popups, no military/tactical iconography.**
- **Color must always be paired with shape or label** for module state (colorblind floor).

### Format & deliverables

- One HTML file per screen, all sharing a single `tokens.css` (generated from DESIGN.md frontmatter — colors, typography, rounded, spacing).
- Use realistic placeholder content from EXPERIENCE.md Key Flows (player names: Maya, Devon, Priya, Sam; serial "KTANE5"; timer "4:32"; etc.) so the mocks read as scenes, not Lorem Ipsum.
- For the 3D bomb on the Bomb View and Spectator Lounge, a stylized 2D representation is fine — a flat front-face render of the chassis with modules visible. Don't attempt real 3D.
- If a screen reveals an ambiguity in the spines, flag it in a comment block at the top of that file rather than silently inventing.

When done, save the eight HTML files plus `tokens.css` to `mockups/` in this run folder.
