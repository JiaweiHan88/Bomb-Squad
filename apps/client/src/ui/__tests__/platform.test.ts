import { describe, it, expect } from 'vitest';
import { evaluateGate, isViewportTooSmall, isMobileUA } from '../platform.js';

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

describe('isViewportTooSmall', () => {
  it('treats the 1280×720 minimum as inclusive (not too small)', () => {
    expect(isViewportTooSmall(1280, 720)).toBe(false);
    expect(isViewportTooSmall(1920, 1080)).toBe(false);
  });

  it('flags either dimension below the minimum', () => {
    expect(isViewportTooSmall(1279, 720)).toBe(true);
    expect(isViewportTooSmall(1280, 719)).toBe(true);
  });
});

describe('isMobileUA', () => {
  it('detects phones/tablets and ignores desktop', () => {
    expect(isMobileUA(IPHONE_UA)).toBe(true);
    expect(isMobileUA(ANDROID_UA)).toBe(true);
    expect(isMobileUA(DESKTOP_UA)).toBe(false);
  });
});

describe('evaluateGate', () => {
  it('returns ok for a supported desktop viewport', () => {
    expect(evaluateGate({ width: 1280, height: 720, userAgent: DESKTOP_UA })).toBe('ok');
    expect(evaluateGate({ width: 1920, height: 1080, userAgent: DESKTOP_UA })).toBe('ok');
  });

  it('bounces mobile even at a large viewport (mobile beats size)', () => {
    expect(evaluateGate({ width: 2560, height: 1440, userAgent: IPHONE_UA })).toBe('mobile');
    expect(evaluateGate({ width: 1920, height: 1080, userAgent: ANDROID_UA })).toBe('mobile');
  });

  it('gates a too-small desktop viewport', () => {
    expect(evaluateGate({ width: 1024, height: 768, userAgent: DESKTOP_UA })).toBe('too-small');
    expect(evaluateGate({ width: 1280, height: 719, userAgent: DESKTOP_UA })).toBe('too-small');
  });
});
