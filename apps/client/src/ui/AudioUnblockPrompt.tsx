import { useVoiceStore } from '../store/voiceStore.js';
import { resumeVoiceAudio } from '../voice/connectVoice.js';
import { VOICE_ENABLE_AUDIO } from './copy.js';

/**
 * Blocked-autoplay recovery affordance (Story 3.6, AC #6). A browser can reject
 * `room.startAudio()` without a user gesture, so a participant is genuinely
 * `connected` (transport up, tracks subscribed) yet hears nothing. `connectVoice`
 * surfaces that as `voiceStore.audioBlocked`; this prompt offers a click-to-resume
 * control while it's set, and a successful `resumeVoiceAudio()` clears the flag.
 *
 * Rendering-only (project-context: components carry zero game logic): the resume
 * logic lives in `voice/connectVoice.ts`. Purely additive playback recovery — the
 * participant stays `connected` and the game is unaffected (never blocks the UI).
 *
 * Self-gates: renders ONLY when `connected && audioBlocked`, so mounting it
 * unconditionally in the HUD (any in-round role) is safe.
 */
export default function AudioUnblockPrompt() {
  const status = useVoiceStore((s) => s.status);
  const audioBlocked = useVoiceStore((s) => s.audioBlocked);

  if (status !== 'connected' || !audioBlocked) return null;

  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
      <button
        type="button"
        aria-label={VOICE_ENABLE_AUDIO}
        onClick={() => void resumeVoiceAudio()}
        className="flex items-center gap-2 rounded-md border border-brass bg-surface-raised px-3 py-2 font-mono text-xs uppercase tracking-widest text-ink-primary transition-colors hover:border-ink-primary"
      >
        <AudioGlyph />
        {VOICE_ENABLE_AUDIO}
      </button>
    </div>
  );
}

/** Speaker glyph — decorative (the button carries the accessible label). */
function AudioGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M17 8a5 5 0 0 1 0 8" />
    </svg>
  );
}
