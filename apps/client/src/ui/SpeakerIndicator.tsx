import { useGameStore } from '../store/gameStore.js';
import { useVoiceStore } from '../store/voiceStore.js';
import { SPEAKING } from './copy.js';

/**
 * In-round speaker indicator (Story 3.4) — the richer cousin of the Story 2.5
 * lobby speaker dot. It renders one **pill** (avatar dot + name + pulse) per
 * currently-transmitting participant, top-left of the HUD, so anyone in the round
 * (including a listen-only spectator) can see who's talking.
 *
 * Rendering-only (project-context: components carry zero game/voice logic):
 * - The pill set is a pure reflection of `voiceStore.activeSpeakers`, which
 *   `connectVoice` already populates from LiveKit `ActiveSpeakersChanged` WITH the
 *   150ms stop-grace flicker suppression applied upstream (Story 2.5). We do NOT
 *   re-implement the grace here — we just map the ids to pills.
 * - Names come from `gameStore.session.players` (the durable-id roster); self is
 *   `gameStore.myPlayerId`. We READ gameStore for display only — never write it.
 *
 * Color (DESIGN.md color reservations): the self pill uses `speaker-self` (cool
 * blue, identity-only); every other active speaker uses `speaker-active` (LED
 * green). Name is ALWAYS shown beside the dot — never icon-only (accessibility
 * floor). The pulse is `motion-safe:`-gated exactly like the lobby dot so
 * reduced-motion users get a static active state (AC #5).
 *
 * Note (the muted self has no pill): `activeSpeakers` only holds ids that are
 * currently transmitting, so a muted self simply drops out — correct. AC #3's
 * "my indicator shows a muted state" is carried by `MuteControl`'s own glyph, not
 * by a persistent self pill.
 *
 * Placement: top-left only, kept clear of the top-center/right timer zone (the
 * timer LCD is Stories 4.4/4.5 — the pill must never collide with it).
 */
export default function SpeakerIndicator() {
  const activeSpeakers = useVoiceStore((s) => s.activeSpeakers);
  const players = useGameStore((s) => s.session?.players);
  const selfId = useGameStore((s) => s.myPlayerId);

  // No one transmitting → nothing to show (a muted self also lands here).
  if (activeSpeakers.length === 0) return null;

  return (
    <div
      data-testid="speaker-indicator"
      // pointer-events-none: purely informational, never steals HUD clicks.
      className="pointer-events-none absolute left-4 top-4 z-10 flex flex-col items-start gap-1.5"
    >
      {activeSpeakers.map((id) => {
        const isSelf = id === selfId;
        // Name always visible (never icon-only). Fall back to the id only if the
        // roster somehow lacks this speaker — still a name, never a bare dot.
        const name = players?.[id]?.displayName ?? id;
        const dotColor = isSelf ? 'bg-speaker-self' : 'bg-speaker-active';
        const textColor = isSelf ? 'text-speaker-self' : 'text-speaker-active';
        return (
          <span
            key={id}
            data-testid={`speaker-pill-${id}`}
            aria-label={`${name} ${SPEAKING}`}
            className={`flex items-center gap-2 rounded-full bg-surface-raised/90 px-3 py-1 font-mono text-xs font-medium ${textColor}`}
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${dotColor} motion-safe:animate-pulse`}
            />
            {name}
          </span>
        );
      })}
    </div>
  );
}
