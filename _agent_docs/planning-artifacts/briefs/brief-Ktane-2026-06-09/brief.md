---
title: 'Bomb Squad — Game Brief'
project: 'Ktane'
status: 'final'
created: '2026-06-09'
updated: '2026-06-09'
author: 'Jay'
---

# Game Brief: Bomb Squad

## Vision

Bomb Squad drops up to 16 players (two teams of 8) into a high-pressure bomb defusal scenario where the person staring at the bomb cannot read the manual, and the people reading the manual cannot see the bomb. The only tool anyone has is their voice.

The game runs in any modern browser with no downloads, no accounts, and no external voice tools required. A facilitator creates a private session, shares a link, and the team plays within minutes. Rounds are structured as a relay race: two teams race through identical bomb layouts with independently randomized values, accumulating time across rounds until every player has taken a turn as the defuser. The team with the lowest cumulative defuse time wins.

This is a purposefully contained internal tool — not a platform, not a service, not a progression game. It is a repeatable team ritual: thirty minutes of communication under pressure, followed by a debrief that is actually interesting because everyone has a story. The codebase will be open-sourced after initial internal use.

**Core fantasy:** Your team survives (or spectacularly fails) a bomb defusal by communicating precisely under pressure — and then argues about it for the rest of the day.

**Vision statement:** Bomb Squad is the team building activity that accidentally reveals how your team communicates. It is tense, funny, and immediately replayable. Every round produces a story.

## Target Players

**Audience:** Internal teams of any role (engineering, product, design, data, management), organized by a team lead or event organizer. Players need only a browser and a microphone. No gaming experience required — rules are learnable in under two minutes. Sessions run 45–90 minutes including setup, rounds, and informal debrief.

**Player count:** 2–16 players per session (up to 8v8). At 2 players there is no spectator — one defuser, one expert. The game scales from an intimate pair session to a full team event.

## Core Fundamentals

**Genre:** Real-time cooperative/competitive puzzle game with communication as the primary mechanic.

**Core loop:** Facilitator configures round (difficulty, time, modules) → assigns defuser → team routes to voice channels → bomb timer starts → defuser describes what they see, experts interpret the manual and give instructions → team defuses or fails → score recorded → roles rotate → repeat until all players have defused.

**Gameplay pillars:**

1. **Communication is the mechanic.** The defuser and experts are information-asymmetric by design. The gap between what the defuser sees and what the manual says is the entire game. Modules force precise verbal description and interpretation, not general knowledge or reflexes.

2. **Pressure is shared.** The timer and strike limit apply to the whole team. Failure is collective. A wrong move is the expert's fault as much as the defuser's — it prevents blame and creates shared investment.

3. **Fairness through structure.** Both teams receive identical module layouts with independently randomized values. The relay race format ensures every player defuses at least once. The facilitator controls pacing, difficulty, and round count; outcomes are not left to chance.

4. **Low floor, replayable ceiling.** A first-time team can survive Wires and The Button in round one. The module pool deepens across rounds and difficulty settings. A team that has played before faces harder modules and tighter clocks — the game grows with the team.

## References & Inspiration

**Keep Talking and Nobody Explodes** — Taking: information-asymmetry mechanic, bomb aesthetic, manual-as-puzzle, module system architecture. Not taking: KTaNE requires one person to run the game with an external PDF manual; Bomb Squad is built for groups with built-in voice and competitive structure.

**Jackbox Party Pack** — Taking: browser join flow (link + code), zero-friction onboarding, facilitator-driven pacing, spectator engagement. Not taking: turn-based party game structure; Bomb Squad is real-time and high-pressure.

## Scope & MVP

**Target platform:** Modern desktop browsers (Chrome, Firefox, Edge). Safari secondary. No mobile app in v1.

**Team:** Solo developer with AI assistance.

**V1 in scope:**
- Lobby system (private, invite-only, join code, 2–16 players / up to 8v8; spectator role only exists when a session has more than 2 active players)
- Relay Race game mode — facilitator configures difficulty and round count per session
- 6 core modules: Wires, The Button, Keypads, Simon Says, Memory, Morse Code
- 3D bomb rendering (React Three Fiber)
- Digital manual viewer — browsable in preparation mode before a round starts
- Built-in WebRTC voice (LiveKit) — Bomb Room + Spectator Lounge channels
- Facilitator dashboard (team assignment, difficulty/round config, round control, scoring)
- Spectator view — bomb view and manual page currently being viewed by experts; spectator chat visibility is facilitator-toggleable
- Bomb generation with facilitator-defined template + per-team value randomization
- End-of-session scoreboard
- Self-hosted Docker Compose deployment

**V1 out of scope:** Hot Seat Rotation mode, custom module authoring, needy modules, session recording/replay, persistent leaderboards, mobile-optimized layouts, parallel defuse, video feeds, internationalization. *(Post-launch / open source: video feed, Hot Seat Rotation, additional module packs, custom module authoring.)*

**MVP (validates core hypothesis):** Two players in a browser — one sees the bomb, one sees the manual, they solve Wires together over voice. If this is tense and satisfying, the core mechanic works. Everything else is content and polish.

## Content & Direction

**Setting:** A stylized bomb — chunky, retro-industrial, slightly absurd. Not realistic military hardware; closer to a cartoon 1960s spy-thriller prop. No narrative — you are defusing a bomb, that is the entire story. The drama comes from the players.

**Aesthetic direction:** 3D bomb with flat/stylized materials — bold colors, thick outlines, readable at a glance. Visual reference: *Keep Talking and Nobody Explodes* module language. No photorealism; 60fps target on a mid-range laptop. Audio: minimal SFX only — ticking countdown during active defusal, module solve chime, explosion on failure, defuse fanfare. No music during rounds; the team's voice is the soundtrack. Light ambient sound in lobby only.

## Risks

**Design risks:**
- The information-asymmetry mechanic only works if module visuals are unambiguous under pressure. Mitigate: user-test every module with people who have not seen it before, specifically testing whether the defuser can describe it accurately under time pressure.
- Teams of unequal size (odd numbers, disconnects mid-round) need explicit handling in the relay race format.
- Spectators seeing both bomb and manual views could coach the active team. Mitigated by the facilitator-toggleable spectator chat visibility option.

**Technical risks:**
- WebRTC / LiveKit voice reliability behind corporate firewalls — the single highest-probability failure point. Mitigate: test behind symmetric NAT before any internal event; document TURN port requirements.
- React Three Fiber performance on mid-range laptops in conference rooms. Mitigate: enforce the 60fps target from day one.
