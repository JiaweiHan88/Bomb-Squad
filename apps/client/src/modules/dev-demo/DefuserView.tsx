import { Text } from '@react-three/drei';
import { useGameStore } from '../../store/gameStore.js';
import type { ModuleDefuserViewProps } from '../registry.js';
import { dispatchModuleAction } from '../dispatch.js';
import { moduleClickHandlers, modulePressHoldHandlers } from '../interaction.js';
import { DEV_DEMO_MODULE_ID, type DevDemoState } from './types.js';

/**
 * dev-demo DefuserView — R3F rendering ONLY, zero game logic. Every visual is
 * data-driven from the module's generated/reduced state; interactions go
 * through the click-primitive helpers and the dispatch seam. The bay frame,
 * MOD-NN tag, and solve LED are ModuleBay's; this renders only the body.
 *
 * Body budget: the bay faceplate is 0.8×0.55 and ModuleBay mounts this group
 * at [0, -0.04, faceZ] — keep geometry within ~0.7×0.4, shallow z.
 */

/** Raw hexes with token names in comments — CSS vars can't reach WebGL (4.x convention). */
const WIRE_COPPER = '#B87333'; // copper wire insulation
const WIRE_END = '#5A5560'; // terminal posts (mockup .bay-tag gray)
const BUTTON_BASE = '#B8924A'; // --color-brass
const BUTTON_CAP = '#3A3A42'; // dark bakelite cap
const TAG_INK = '#E8E3D5'; // stencil ink on dark plate

const WIRE_LENGTH = 0.42;
const WIRE_RADIUS = 0.018;
const WIRE_POS: [number, number, number] = [-0.13, -0.02, 0.02];
const BUTTON_POS: [number, number, number] = [0.2, -0.02, 0.02];

function selectDevDemoData(moduleIndex: number) {
  return (s: ReturnType<typeof useGameStore.getState>): DevDemoState | null => {
    const mod = s.bomb?.modules[moduleIndex];
    // moduleId check guards a desynced payload from rendering garbage.
    return mod?.moduleId === DEV_DEMO_MODULE_ID ? (mod.data as DevDemoState) : null;
  };
}

export function DevDemoDefuserView({ moduleIndex }: ModuleDefuserViewProps) {
  // Snapshot-rate reactive selector (returns the stable `data` reference, so
  // unrelated store broadcasts don't re-render) — getState() is only for
  // per-frame reads, and nothing here is per-frame.
  const data = useGameStore(selectDevDemoData(moduleIndex));
  if (!data) return null;

  const cut = moduleClickHandlers(() => dispatchModuleAction(moduleIndex, { type: 'CUT' }));
  const pressHold = modulePressHoldHandlers(
    () => dispatchModuleAction(moduleIndex, { type: 'BUTTON_DOWN' }),
    () => dispatchModuleAction(moduleIndex, { type: 'BUTTON_UP' }),
  );

  return (
    <group>
      {/* Stencilled tag — the Defuser-visible lookup key (read it to the Expert). */}
      <Text
        font="/fonts/jetbrains-mono-700.ttf"
        fontSize={0.07}
        color={TAG_INK}
        letterSpacing={0.12}
        anchorX="center"
        anchorY="middle"
        position={[0, 0.13, 0.02]}
      >
        {data.label}
      </Text>

      {/* Wire — cut = single click. Severed wires render as two drooping stubs. */}
      <group position={WIRE_POS} {...cut}>
        {data.wireCut ? (
          <>
            <mesh position={[-WIRE_LENGTH / 4, -0.012, 0]} rotation={[0, 0, 0.35]}>
              <cylinderGeometry args={[WIRE_RADIUS, WIRE_RADIUS, WIRE_LENGTH / 2 - 0.03, 8]} />
              <meshStandardMaterial color={WIRE_COPPER} />
            </mesh>
            <mesh position={[WIRE_LENGTH / 4, -0.012, 0]} rotation={[0, 0, -0.35]}>
              <cylinderGeometry args={[WIRE_RADIUS, WIRE_RADIUS, WIRE_LENGTH / 2 - 0.03, 8]} />
              <meshStandardMaterial color={WIRE_COPPER} />
            </mesh>
          </>
        ) : (
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[WIRE_RADIUS, WIRE_RADIUS, WIRE_LENGTH, 8]} />
            <meshStandardMaterial color={WIRE_COPPER} />
          </mesh>
        )}
        {/* Terminal posts anchor the wire visually and pad the click target. */}
        {([-1, 1] as const).map((side) => (
          <mesh key={side} position={[(side * WIRE_LENGTH) / 2, 0, 0]}>
            <boxGeometry args={[0.04, 0.06, 0.04]} />
            <meshStandardMaterial color={WIRE_END} />
          </mesh>
        ))}
      </group>

      {/* Button — press = down+up, hold = down…sustain…up. Sinks while held. */}
      <group position={BUTTON_POS} {...pressHold}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.085, 0.085, 0.02, 24]} />
          <meshStandardMaterial color={BUTTON_BASE} />
        </mesh>
        <mesh position={[0, 0, data.held ? 0.012 : 0.026]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.06, 0.06, 0.022, 24]} />
          <meshStandardMaterial color={BUTTON_CAP} />
        </mesh>
      </group>
    </group>
  );
}
