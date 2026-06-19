import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceStore } from '../../store/voiceStore.js';
import AudioUnblockPrompt from '../AudioUnblockPrompt.js';
import { VOICE_ENABLE_AUDIO } from '../copy.js';

/**
 * AudioUnblockPrompt render-gating tests (Story 3.6, AC #6). The prompt shows
 * ONLY when voice is `connected` AND `audioBlocked` (a connected-but-silent
 * participant), and its click calls `resumeVoiceAudio()`. Resume logic lives in
 * connectVoice (covered there) — here we pin the gate + the wired affordance.
 */
const resumeVoiceAudio = vi.fn(async () => undefined);
vi.mock('../../voice/connectVoice.js', () => ({
  resumeVoiceAudio: () => resumeVoiceAudio(),
}));

beforeEach(() => {
  resumeVoiceAudio.mockClear();
  useVoiceStore.setState({ status: 'connected', audioBlocked: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  useVoiceStore.setState({ status: 'idle', audioBlocked: false });
});

describe('AudioUnblockPrompt', () => {
  it('shows when connected and audioBlocked', () => {
    render(<AudioUnblockPrompt />);
    expect(screen.getByRole('button', { name: VOICE_ENABLE_AUDIO })).toBeInTheDocument();
  });

  it('calls resumeVoiceAudio on click', () => {
    render(<AudioUnblockPrompt />);
    fireEvent.click(screen.getByRole('button', { name: VOICE_ENABLE_AUDIO }));
    expect(resumeVoiceAudio).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when audio is not blocked', () => {
    useVoiceStore.setState({ status: 'connected', audioBlocked: false });
    const { container } = render(<AudioUnblockPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when not connected (even if audioBlocked lingers)', () => {
    useVoiceStore.setState({ status: 'connecting', audioBlocked: true });
    const { container } = render(<AudioUnblockPrompt />);
    expect(container).toBeEmptyDOMElement();
  });
});
