import { memo } from 'react';
import { Text } from '@react-three/drei';
import { useGameStore } from '../store/gameStore.js';
import { CHASSIS_SIZE } from './layout.js';
import {
  STRIKE_DOT_INDICES,
  STRIKE_HOUSING_CENTER_X,
  STRIKE_HOUSING_SIZE,
  STRIKE_LED_RADIUS,
  STRIKE_LED_SEPARATION,
  strikeLedVisual,
} from './strikeIndicator.js';
import { TIMER_HOUSING_CENTER_Z } from './timerLcd.js';

/**
 * Diegetic strike indicator (Story 4.5) — 2 LED dots on a graphite block
 * beside the timer housing (EXPERIENCE: "Strike indicator LEDs (on the
 * chassis face)"; glance hierarchy #2, adjacent right of timer). Rendering
 * only: the dots render bomb.strikes verbatim — team-wide server truth, no
 * client derivation, no attribution.
 *
 * Strikes change at event rate, not tick rate, so a reactive Zustand selector
 * is the correct access pattern (the CameraRig click-rate ruling) — there is
 * deliberately NO useFrame here: DESIGN's strikeIndicator spec has no motion,
 * activation is an instant state swap (which also satisfies reduced-motion
 * for free). The selected value is a primitive, so MODULE_UPDATE /
 * TIMER_UPDATE broadcasts never re-render this component.
 */

/** Same tilt/seating as the timer housing — the pair reads as one cluster. */
const HOUSING_TILT_X = -0.18;
const HOUSING_Y = CHASSIS_SIZE[1] / 2 + STRIKE_HOUSING_SIZE[1] / 2 - 0.03;

/** Face-local z stack on the housing's +z face (z-fight guard steps). */
const FACE_Z = STRIKE_HOUSING_SIZE[2] / 2;
const SOCKET_Z = FACE_Z + 0.006;
const LED_Z = FACE_Z + 0.01;

/** Dots sit low on the face (mirroring the timer's LCD line); the STRIKES
 *  caption rides ABOVE them — the mockup puts it below, but the battery tray
 *  in front of the housing occludes the bottom edge at the overview camera
 *  (4.4's measured occlusion lesson; anatomy reference, not dimension
 *  authority). The mockup's faint ✕ glyph inside each dot is dropped: a
 *  glyph-coverage gamble in the vendored mono font for a decorative detail. */
const DOT_ROW_Y = -0.025;
const CAPTION_Y = 0.175;

/** Recessed socket ring behind each LED (mockup inset shadow), near-black. */
const SOCKET_RADIUS = STRIKE_LED_RADIUS + 0.009;

export const StrikeIndicator = memo(function StrikeIndicator() {
  // The component's ONLY store subscription — a primitive, equality-bailed.
  const strikes = useGameStore((s) => s.bomb?.strikes ?? 0);

  return (
    <group
      position={[STRIKE_HOUSING_CENTER_X, HOUSING_Y, TIMER_HOUSING_CENTER_Z]}
      rotation={[HOUSING_TILT_X, 0, 0]}
    >
      {/* Housing — --color-graphite #1A1A1F (raw hex; CSS vars can't reach WebGL) */}
      <mesh>
        <boxGeometry args={STRIKE_HOUSING_SIZE} />
        <meshStandardMaterial color="#1A1A1F" />
      </mesh>

      {/* Dots — data-driven from STRIKE_DOT_INDICES, never JSX repetition.
          Visuals come verbatim from strikeLedVisual (tested pure fn). */}
      {STRIKE_DOT_INDICES.map((dotIndex) => {
        const visual = strikeLedVisual(dotIndex, strikes);
        const x = (dotIndex - 0.5) * STRIKE_LED_SEPARATION;
        return (
          <group key={dotIndex} position={[x, DOT_ROW_Y, 0]}>
            <mesh position={[0, 0, SOCKET_Z]}>
              <circleGeometry args={[SOCKET_RADIUS, 24]} />
              <meshStandardMaterial color="#0D0B0E" />
            </mesh>
            <mesh position={[0, 0, LED_Z]}>
              <circleGeometry args={[STRIKE_LED_RADIUS, 24]} />
              <meshStandardMaterial
                color={visual.color}
                emissive={visual.emissive}
                emissiveIntensity={visual.emissiveIntensity}
              />
            </mesh>
          </group>
        );
      })}

      {/* Caption — mockup .cap (mono, letterspaced). Ink #5A5560: the bay-tag
          graphite convention; the mockup's #3A1410 is illegible here (4.4's
          documented label-ink ruling). 9px ≈ 0.038wu cap height. */}
      <Text
        font="/fonts/jetbrains-mono-700.ttf"
        fontSize={0.038}
        color="#5A5560"
        letterSpacing={0.22}
        anchorX="center"
        anchorY="middle"
        position={[0, CAPTION_Y, FACE_Z + 0.006]}
      >
        STRIKES
      </Text>
    </group>
  );
});
