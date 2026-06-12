import { describe, it, expect } from 'vitest';
import { buildShareLink } from '../shareLink.js';

describe('buildShareLink', () => {
  it('builds a ?join= query link on the root path (no path routes — no SPA fallback)', () => {
    expect(buildShareLink('https://bomb.example', 'KTANE5')).toBe(
      'https://bomb.example/?join=KTANE5',
    );
  });

  it('keeps an explicit port in the origin', () => {
    expect(buildShareLink('http://localhost:5173', 'ABC123')).toBe(
      'http://localhost:5173/?join=ABC123',
    );
  });

  it('URL-encodes the code defensively (charset makes this a no-op in practice)', () => {
    expect(buildShareLink('http://localhost:5173', 'A B&C')).toBe(
      'http://localhost:5173/?join=A%20B%26C',
    );
  });
});
