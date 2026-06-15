/**
 * Operator-world microcopy — dry / deadpan / period-appropriate (EXPERIENCE.md
 * "Voice and Tone"). Single home for the strings used by the UI shell so later
 * Epic-2 screens reuse the same voice. Not an i18n system — just one source.
 */
export const CONNECTING = 'Connecting…';
export const GATE_RESIZE = 'Resize your window — Bomb Squad needs more room';
export const GATE_MOBILE = 'Bomb Squad is a desktop experience';
export const CONFIRM = 'Confirm';
export const CANCEL = 'Cancel';

// Landing (Story 2.2)
export const HOST_A_SESSION = 'Host a session';
export const HOST_PITCH = 'No accounts. One code, one link — your team plays in the browser.';
export const HOST_BUSY = 'Opening a line…';
export const HOST_FAILED = 'Could not open a session. Try again.';

// Join panel (Story 2.3) — mockup "1. Landing" copy.
export const ENTER_A_JOIN_CODE = 'Enter a join code';
export const JOIN_HELP = 'Six characters, from your facilitator.';
export const JOIN_HELP_EMPHASIS = 'Submits on the sixth.';
export const YOUR_NAME = 'Your name';
export const ROLE_DEFUSER = 'Defuser';
export const ROLE_EXPERT = 'Expert';
export const ROLE_SPECTATOR = 'Spectator';
export const JOIN_INCOMPLETE = 'Add a name and pick a role — then it sends itself.';
export const JOIN_BUSY = 'Checking the code…';
export const JOIN_TIMEOUT = 'No answer from the server. Try again.';
export const OR_DIVIDER = 'or';

// Lobby roster (Story 2.3) — mockup "2. Lobby" roster panel.
export const TEAM_ROSTER = 'Team roster';
export const YOU_TAG = 'You';
export const ROLE_FACILITATOR = 'Facilitator';

// Facilitator player controls (Story 2.7) — secondary-confirm Remove on a row.
export const REMOVE_PLAYER = 'Remove';
export const REMOVE_CONFIRM = 'Remove';

// Share-link Join button (Story 2.7) — shown when a prefilled code is complete.
export const JOIN_NOW = 'Join';

// Lobby ready + mic check (Story 2.5). Ready is informational/self-toggle; the
// speaker dot is the lobby's only sanctioned green ("audible"). Names always
// shown beside the dot (colorblind floor). Connect microcopy reuses VOICE_*.
export const READY = 'Ready';
export const MARK_READY = 'Mark ready';
export const READY_INDICATOR = 'Ready';
export const MIC_CHECK_CTA = 'Join mic check';
export const WAITING_FOR_TEAM = 'Waiting for your team.';
// Accessible labels for the per-row speaker dot (never icon-only).
export const SPEAKING = 'speaking';
export const MIC_QUIET = 'quiet';

// Team assignment (Story 2.4) — mockup "6. Facilitator Dashboard" team badges.
export const TEAM_A = 'Team A';
export const TEAM_B = 'Team B';
export const UNASSIGNED = 'Unassigned';

// Lobby share panel (Story 2.2) — EXPERIENCE.md: "Bring them in", never "Invite Players".
export const BRING_THEM_IN = 'Bring them in';
export const SHARE_SUB =
  "Share the join code or link. Players land here as they enter — assign roles once everyone's in.";
export const COPY_LINK = 'Copy link';
export const COPIED = 'Copied';

// Preparation phase (Story 8.3) — prep has no countdown; the facilitator ends
// it by starting the round (GDD A9: 2–5 min is guidance, not enforcement).
export const OPEN_PREPARATION = 'Open preparation';
export const PREP_NEEDS_TEAM = 'Assign at least one player to a team first.';
export const BACK_TO_LOBBY = 'Back to lobby';
export const PREP_HEADING = 'Preparation';
export const PREP_GUIDANCE =
  'Walk them through the manual — two to five minutes is the sweet spot. Start when they stop arguing.';
export const ON_THE_BOMB_NEXT = 'On the bomb next';
export const START_THE_ROUND = 'Start the round';
export const PREP_MANUAL_LINE = "You're on the manual. Read fast.";
// Story 4.6: the upcoming Defuser's prep surface is now the placeholder bomb
// itself (PrepBombView), not a text line — the former PREP_DEFUSER_LINE /
// PREP_DEFUSER_PLACEHOLDER copy is retired.

// Active round (Story 8.3) — interim non-defuser surfaces; 8.5+/Epic 9 own the real ones.
export const ROUND_IN_PROGRESS = 'Round in progress.';
export const WATCHING_THE_BOMB_ROOM = 'Watching the bomb room. Keep it down.';

// Round resolution (Story 8.5) — all-caps, terminal punctuation (EXPERIENCE.md
// round-result copy). DETONATED = 3rd strike; TIME EXPIRED = clock hit 0.
export const RESULT_DEFUSED = 'DEFUSED.';
export const RESULT_DETONATED = 'DETONATED.';
export const RESULT_TIME_EXPIRED = 'TIME EXPIRED.';
// Interim post-round surface — Story 8.6 (between-rounds + scoreboard preview)
// replaces this. Deliberately NOT a scoreboard (AC-3: no mid-round scoreboard).
export const BETWEEN_ROUNDS_PLACEHOLDER = 'Round over. Stand by for the next one.';

// Bomb Room voice (Story 3.2) — the join affordance + EXPERIENCE.md voice
// microcopy. The speaker pill + mute toggle are Story 3.4, not here.
export const VOICE_CONNECT_CTA = 'Connect to Bomb Room voice';
export const VOICE_CONNECTING = 'Connecting to Bomb Room…';
export const VOICE_CONNECTED = 'Bomb Room voice connected.';
// Non-blocking failure microcopy — the game keeps running (AC #4); dismissible.
export const VOICE_UNAVAILABLE = 'Voice unavailable — game continues without it';
export const VOICE_DISMISS = 'Dismiss';
