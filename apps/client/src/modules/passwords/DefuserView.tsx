import { useMemo } from 'react';
import { Text } from '@react-three/drei';
import { useGameStore } from '../../store/gameStore.js';
import type { ModuleDefuserViewProps } from '../registry.js';
import { dispatchModuleAction } from '../dispatch.js';
import { moduleClickHandlers } from '../interaction.js';
import { PASSWORDS_MODULE_ID, type PasswordsState } from './types.js';

/**
 * Passwords DefuserView — R3F rendering ONLY, zero game logic. The five columns,
 * their visible letters, and the SUBMIT control are fully data-driven from the
 * generated PasswordsState (the column count is never hardcoded — we map over
 * data.columns). The solve confirmation is ModuleBay's LED, not module chrome.
 *
 * Interaction is the single-click primitive (moduleClickHandlers): each up/down
 * arrow cycles one column by ±1, SUBMIT validates the shown word. The reducer
 * judges everything — the view only dispatches. No timer, no colour (it's
 * letters), so unlike the-button there is nothing to read from the clock.
 *
 * Body budget: the bay faceplate is 0.8×0.55 and ModuleBay mounts this group at
 * [0, -0.04, faceZ] — geometry stays within ~0.7×0.4, shallow z.
 */

const INK = '#E5DDC9'; // bone letter ink (mockup palette)
const ARROW_INK = '#8A8590'; // mockup gray for the cycle arrows
const SLOT = '#23202A'; // near-bakelite letter window
const SUBMIT_FACE = '#3B7BE0'; // blue SUBMIT cap (mockup .wire.blue)
const SUBMIT_INK = '#1A1820';

const COLUMN_SPAN = 0.6; // total horizontal span for the columns
const LETTER_Y = 0.04;
const ARROW_UP_Y = 0.17;
const ARROW_DOWN_Y = -0.09;
const SUBMIT_Y = -0.2;

function selectPasswordsData(moduleIndex: number) {
  return (s: ReturnType<typeof useGameStore.getState>): PasswordsState | null => {
    const mod = s.bomb?.modules[moduleIndex];
    // moduleId check guards a desynced payload from rendering garbage.
    return mod?.moduleId === PASSWORDS_MODULE_ID ? (mod.data as PasswordsState) : null;
  };
}

export function PasswordsDefuserView({ moduleIndex }: ModuleDefuserViewProps) {
  // Snapshot-rate reactive selector — memoized on moduleIndex so the reference
  // is stable across renders; zustand only re-subscribes when moduleIndex
  // changes. Nothing per-frame here.
  const selector = useMemo(() => selectPasswordsData(moduleIndex), [moduleIndex]);
  const data = useGameStore(selector);

  const submit = useMemo(
    () => moduleClickHandlers(() => dispatchModuleAction(moduleIndex, { type: 'SUBMIT' })),
    [moduleIndex],
  );

  if (!data) return null;

  const columns = data.columns.length;
  const spacing = columns > 1 ? COLUMN_SPAN / (columns - 1) : 0;
  const leftX = -COLUMN_SPAN / 2;

  return (
    <group>
      {data.columns.map((letters, columnIndex) => {
        const x = leftX + columnIndex * spacing;
        const letter = letters[data.positions[columnIndex]] ?? '';
        // Each arrow is a single click that cycles THIS column (the reducer
        // wraps modulo six and judges; the view only dispatches).
        const up = moduleClickHandlers(() =>
          dispatchModuleAction(moduleIndex, { type: 'CYCLE', columnIndex, direction: 'up' }),
        );
        const down = moduleClickHandlers(() =>
          dispatchModuleAction(moduleIndex, { type: 'CYCLE', columnIndex, direction: 'down' }),
        );
        return (
          <group key={columnIndex} position={[x, 0, 0.02]}>
            {/* Up arrow */}
            <group position={[0, ARROW_UP_Y, 0]} {...up}>
              <mesh>
                <boxGeometry args={[0.09, 0.06, 0.02]} />
                <meshStandardMaterial color={SLOT} />
              </mesh>
              <Text font="/fonts/jetbrains-mono-700.ttf" fontSize={0.05} color={ARROW_INK} anchorX="center" anchorY="middle" position={[0, 0, 0.02]}>
                ▲
              </Text>
            </group>

            {/* Letter window */}
            <mesh position={[0, LETTER_Y, 0]}>
              <boxGeometry args={[0.1, 0.12, 0.02]} />
              <meshStandardMaterial color={SLOT} />
            </mesh>
            <Text
              font="/fonts/jetbrains-mono-700.ttf"
              fontSize={0.08}
              color={INK}
              anchorX="center"
              anchorY="middle"
              position={[0, LETTER_Y, 0.02]}
            >
              {letter.toUpperCase()}
            </Text>

            {/* Down arrow */}
            <group position={[0, ARROW_DOWN_Y, 0]} {...down}>
              <mesh>
                <boxGeometry args={[0.09, 0.06, 0.02]} />
                <meshStandardMaterial color={SLOT} />
              </mesh>
              <Text font="/fonts/jetbrains-mono-700.ttf" fontSize={0.05} color={ARROW_INK} anchorX="center" anchorY="middle" position={[0, 0, 0.02]}>
                ▼
              </Text>
            </group>
          </group>
        );
      })}

      {/* SUBMIT — one click validates the shown word. */}
      <group position={[0, SUBMIT_Y, 0.02]} {...submit}>
        <mesh>
          <boxGeometry args={[0.26, 0.08, 0.02]} />
          <meshStandardMaterial color={SUBMIT_FACE} />
        </mesh>
        <Text
          font="/fonts/jetbrains-mono-700.ttf"
          fontSize={0.045}
          color={SUBMIT_INK}
          anchorX="center"
          anchorY="middle"
          position={[0, 0, 0.02]}
        >
          SUBMIT
        </Text>
      </group>
    </group>
  );
}
