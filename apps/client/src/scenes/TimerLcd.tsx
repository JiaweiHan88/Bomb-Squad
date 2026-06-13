import { memo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import { AdditiveBlending, type Mesh, type MeshBasicMaterial } from 'three';
import { useGameStore } from '../store/gameStore.js';
import { CHASSIS_SIZE } from './layout.js';
import { prefersReducedMotion } from './dom.js';
import {
  LCD_GLOW_BASE,
  TIMER_DIGIT_HEIGHT,
  TIMER_HOUSING_CENTER_Z,
  TIMER_HOUSING_SIZE,
  formatTimerDisplay,
  lcdGlowIntensity,
  timerGhostFor,
  timerRemainingMs,
} from './timerLcd.js';
import { serverNow } from '../net/serverClock.js';

/**
 * Diegetic 7-segment timer LCD (Story 4.4) — a graphite housing on the chassis
 * top band, between the indicator zone and the battery tray (placement math +
 * overlap tests live in timerLcd.ts). Rendering only: the displayed time is a
 * per-frame extrapolation of the server's TimerState (ADR-005); the client
 * holds at 0:00 and never owns expiry (AC3). Digits never animate — the glow
 * plane's opacity is the LCD's single animated scalar (AC2).
 */

/** troika Text instance surface drei's <Text> forwards its ref to. */
type TroikaText = Mesh & { text: string; sync: () => void };

/** Tilt the housing's +z (LCD) face slightly upward toward the overview camera
 *  (camera elevation ≈ atan(1.1/5.2) ≈ 12°). */
const HOUSING_TILT_X = -0.18;
/** Housing centre: resting on the top face, sunk a hair so the tilted base
 *  never shows a floating back edge. */
const HOUSING_Y = CHASSIS_SIZE[1] / 2 + TIMER_HOUSING_SIZE[1] / 2 - 0.03;

/** LCD assembly local z stack on the housing's +z face (z-fight guard steps). */
const FACE_Z = TIMER_HOUSING_SIZE[2] / 2;
const PLATE_Z = FACE_Z + 0.006;
const GHOST_Z = FACE_Z + 0.01;
const LIVE_Z = FACE_Z + 0.012;
/** Glow sits in FRONT of the stack: additive blending only adds light, so the
 *  digits stay readable while the whole LCD washes red — putting it behind the
 *  opaque plate would reduce the glow to an invisible 0.04 rim. */
const GLOW_Z = FACE_Z + 0.014;

/** LCD plate (bg #240807); the graphite housing itself reads as the border. */
const PLATE_SIZE: [number, number] = [1.0, 0.46];
/** Glow halo plane, slightly larger than the plate; opacity = the animated scalar. */
const GLOW_SIZE: [number, number] = [1.08, 0.54];
/** Base opacity at glow intensity 1.0 (≈ DESIGN glow 0 0 16px rgba(255,59,48,.45)). */
const GLOW_OPACITY_SCALE = 0.12;
/** LCD sits low in the housing; the label rides ABOVE the digits. The mockup
 *  puts T—MINUS below the LCD, but in 3D the battery tray in front of the
 *  housing occludes anything near the housing's bottom edge at the overview
 *  camera — the nameplate position keeps it readable (anatomy reference, not
 *  dimension authority — the 4.2/4.3 mockup-precedence ruling). */
const LCD_CENTER_Y = -0.025;
const LABEL_Y = 0.235;

export const TimerLcd = memo(function TimerLcd() {
  // Snapshot-rate reactive read (strikes drive the glow base, DESIGN
  // "+20% per strike"); mirrored into a ref for the per-frame driver. This is
  // the component's ONLY store subscription — module updates don't reach it.
  const strikes = useGameStore((s) => s.bomb?.strikes ?? 0);
  const strikesRef = useRef(strikes);
  strikesRef.current = strikes;

  const liveRef = useRef<TroikaText>(null);
  const ghostRef = useRef<TroikaText>(null);
  const glowMatRef = useRef<MeshBasicMaterial>(null);
  const lastDisplayRef = useRef('');
  const reducedRef = useRef(false);

  // Per-frame driver: tick-rate reads via getState() (never reactive hooks
  // here); troika .text/.sync() only when the formatted string changes
  // (≤1/sec — per-frame sync would thrash glyph layout); glow is a single
  // scalar write; zero allocations in the callback.
  useFrame(() => {
    const live = liveRef.current;
    const glowMat = glowMatRef.current;
    if (!live || !glowMat) return;

    const timer = useGameStore.getState().timer;
    let glow = LCD_GLOW_BASE; // idle (no TimerState yet): dark ghost only
    let display = '';
    if (timer !== null) {
      const remaining = timerRemainingMs(timer, serverNow());
      display = formatTimerDisplay(remaining);
      glow = lcdGlowIntensity(remaining, strikesRef.current, reducedRef.current);
    }

    if (display !== lastDisplayRef.current) {
      lastDisplayRef.current = display;
      // Sampled on the ≤1/sec edge, not per frame (matchMedia allocates).
      reducedRef.current = prefersReducedMotion();
      live.text = display;
      live.sync();
      const ghost = timerGhostFor(display === '' ? '0:00' : display);
      const ghostText = ghostRef.current;
      if (ghostText && ghostText.text !== ghost) {
        ghostText.text = ghost;
        ghostText.sync();
      }
    }

    const opacity = glow * GLOW_OPACITY_SCALE;
    if (glowMat.opacity !== opacity) glowMat.opacity = opacity;
  });

  return (
    <group position={[0, HOUSING_Y, TIMER_HOUSING_CENTER_Z]} rotation={[HOUSING_TILT_X, 0, 0]}>
      {/* Housing — --color-graphite #1A1A1F (raw hex; CSS vars can't reach WebGL).
          DESIGN componentSpec.timer border is graphite — the housing IS the border. */}
      <mesh>
        <boxGeometry args={TIMER_HOUSING_SIZE} />
        <meshStandardMaterial color="#1A1A1F" />
      </mesh>

      <group position={[0, LCD_CENTER_Y, 0]}>
        {/* Glow halo — --timer-lcd #FF3B30; opacity is the ONLY animated value (AC2) */}
        <mesh position={[0, 0, GLOW_Z]}>
          <planeGeometry args={GLOW_SIZE} />
          <meshBasicMaterial
            ref={glowMatRef}
            color="#FF3B30"
            transparent
            opacity={LCD_GLOW_BASE * GLOW_OPACITY_SCALE}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </mesh>

        {/* LCD plate — --timer-lcd-bg #240807 */}
        <mesh position={[0, 0, PLATE_Z]}>
          <planeGeometry args={PLATE_SIZE} />
          <meshBasicMaterial color="#240807" />
        </mesh>

        {/* Ghost segments — mockup .timer .ghost: lcd red at 10% (8:88, DSEG
            all-segments glyph; updated only when the display gains a digit) */}
        <Text
          ref={ghostRef}
          font="/fonts/DSEG7Classic-Regular.ttf"
          fontSize={TIMER_DIGIT_HEIGHT}
          color="#FF3B30"
          fillOpacity={0.1}
          anchorX="center"
          anchorY="middle"
          position={[0, 0, GHOST_Z]}
        >
          8:88
        </Text>

        {/* Live digits — --timer-lcd #FF3B30 @ 84px ≈ 0.35wu (timerLcd.ts math).
            Driven via ref + sync() from useFrame; starts empty (idle). */}
        <Text
          ref={liveRef}
          font="/fonts/DSEG7Classic-Regular.ttf"
          fontSize={TIMER_DIGIT_HEIGHT}
          color="#FF3B30"
          anchorX="center"
          anchorY="middle"
          position={[0, 0, LIVE_Z]}
        >
          {''}
        </Text>
      </group>

      {/* Label — EXPERIENCE microcopy "T-MINUS, not Time Left". Mockup ink
          #3A1410 sits on the bakelite band; on this graphite housing it is
          illegible, so the established graphite micro-label ink #5A5560
          (bay-tag convention) carries the mockup's intent. */}
      <Text
        font="/fonts/jetbrains-mono-700.ttf"
        fontSize={0.045}
        color="#5A5560"
        letterSpacing={0.3}
        anchorX="center"
        anchorY="middle"
        position={[0, LABEL_Y, FACE_Z + 0.006]}
      >
        T — MINUS
      </Text>
    </group>
  );
});
