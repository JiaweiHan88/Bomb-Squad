import { useCallback, useMemo } from 'react';
import { Text } from '@react-three/drei';
import { useGameStore } from '../../store/gameStore.js';
import { serverNow } from '../../net/serverClock.js';
import { formatTimerDisplay, timerRemainingMs } from '../../scenes/timerLcd.js';
import type { ModuleDefuserViewProps } from '../registry.js';
import { dispatchModuleAction } from '../dispatch.js';
import { modulePressHoldHandlers } from '../interaction.js';
import {
  BUTTON_MODULE_ID,
  BUTTON_COLOR_LABELS,
  type ButtonColor,
  type StripColor,
  type ButtonState,
} from './types.js';

/**
 * The Button DefuserView — R3F rendering ONLY, zero game logic. The button's
 * colour, label, and (while held) the release strip are data-driven from the
 * generated ButtonState; the solve confirmation is ModuleBay's LED, not module
 * chrome.
 *
 * Interaction is the 5.1 press/hold primitive (modulePressHoldHandlers): PRESS
 * on pointer-down, RELEASE on pointer-up. The reducer judges tap-vs-hold — the
 * view never measures duration (interaction.ts contract). RELEASE carries the
 * digits currently shown on the timer LCD so the reducer can check the strip
 * rule purely (project-context: pass time as state input, never read a clock in
 * logic; here the read happens in the view at the release instant).
 *
 * Body budget: the bay faceplate is 0.8×0.55 and ModuleBay mounts this group at
 * [0, -0.04, faceZ] — geometry stays within ~0.7×0.4, shallow z.
 */

/** Raw hexes with token names in comments — CSS vars can't reach WebGL (4.x convention). */
const BUTTON_TINTS: Readonly<Record<ButtonColor, string>> = {
  red: '#D8402F', // mockup .wire.red gradient mid (shared palette)
  blue: '#3B7BE0',
  white: '#E5DDC9',
  yellow: '#E0B53C',
};
const STRIP_TINTS: Readonly<Record<StripColor, string>> = {
  blue: '#3B7BE0',
  white: '#E5DDC9',
  yellow: '#E0B53C',
  red: '#D8402F',
};
const LABEL_INK = '#1A1820'; // dark ink on the button cap
const STRIP_LABEL_INK = '#8A8590'; // mockup .wire-lab gray
const HOUSING = '#2A2730'; // graphite button housing
const STRIP_UNLIT = '#23202A'; // near-bakelite when not held

const BUTTON_RADIUS = 0.16;
const STRIP_X = 0.27; // release strip sits on the button's right side

/** The digits currently shown on the countdown LCD (e.g. "1:43" → [1,4,3]).
 *  Read at the release instant from the authoritative server TimerState; an
 *  absent timer (e.g. the bare sandbox) yields no digits → a hold cannot match. */
function currentTimerDigits(): number[] {
  const timer = useGameStore.getState().timer;
  if (timer === null) return [];
  return formatTimerDisplay(timerRemainingMs(timer, serverNow()))
    .replace(/\D/g, '')
    .split('')
    .map(Number);
}

function selectButtonData(moduleIndex: number) {
  return (s: ReturnType<typeof useGameStore.getState>): ButtonState | null => {
    const mod = s.bomb?.modules[moduleIndex];
    // moduleId check guards a desynced payload from rendering garbage.
    return mod?.moduleId === BUTTON_MODULE_ID ? (mod.data as ButtonState) : null;
  };
}

export function ButtonDefuserView({ moduleIndex }: ModuleDefuserViewProps) {
  // Snapshot-rate reactive selector — memoized on moduleIndex so the reference
  // is stable across renders; zustand only re-subscribes when moduleIndex
  // changes. Nothing per-frame here.
  const selector = useMemo(() => selectButtonData(moduleIndex), [moduleIndex]);
  const data = useGameStore(selector);

  const handlers = useMemo(
    () =>
      modulePressHoldHandlers(
        () => dispatchModuleAction(moduleIndex, { type: 'PRESS' }),
        () => dispatchModuleAction(moduleIndex, { type: 'RELEASE', timerDigits: currentTimerDigits() }),
      ),
    [moduleIndex],
  );

  const labelLetter = useCallback(
    (color: ButtonColor | StripColor) => BUTTON_COLOR_LABELS[color],
    [],
  );

  if (!data) return null;

  const tint = BUTTON_TINTS[data.color];
  const stripTint = data.held ? STRIP_TINTS[data.stripColor] : STRIP_UNLIT;

  return (
    <group>
      {/* The button: a coloured cap on a graphite housing. The whole group is
          the press/hold target. */}
      <group {...handlers}>
        {/* Housing collar */}
        <mesh position={[0, 0, 0.01]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[BUTTON_RADIUS + 0.03, BUTTON_RADIUS + 0.03, 0.04, 24]} />
          <meshStandardMaterial color={HOUSING} />
        </mesh>
        {/* Coloured cap */}
        <mesh position={[0, 0, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[BUTTON_RADIUS, BUTTON_RADIUS, 0.06, 24]} />
          <meshStandardMaterial color={tint} />
        </mesh>
        {/* Printed label on the cap — colorblind floor: text, not colour alone. */}
        <Text
          font="/fonts/jetbrains-mono-700.ttf"
          fontSize={0.05}
          color={LABEL_INK}
          anchorX="center"
          anchorY="middle"
          position={[0, 0, 0.085]}
          maxWidth={BUTTON_RADIUS * 1.8}
          textAlign="center"
        >
          {data.label.toUpperCase()}
        </Text>
      </group>

      {/* Release strip on the right — lit only while held, with its colour
          letter so colour is never the only signal. */}
      <group position={[STRIP_X, 0, 0.03]}>
        <mesh>
          <boxGeometry args={[0.05, 0.34, 0.02]} />
          <meshStandardMaterial
            color={stripTint}
            emissive={data.held ? stripTint : '#000000'}
            emissiveIntensity={data.held ? 0.6 : 0}
          />
        </mesh>
        {data.held ? (
          <Text
            font="/fonts/jetbrains-mono-700.ttf"
            fontSize={0.04}
            color={STRIP_LABEL_INK}
            anchorX="center"
            anchorY="middle"
            position={[0.06, 0, 0.02]}
          >
            {labelLetter(data.stripColor)}
          </Text>
        ) : null}
      </group>
    </group>
  );
}
