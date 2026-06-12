import { memo, useMemo } from 'react';
import { Text } from '@react-three/drei';
import type { BombContext, IndicatorLabel, PortType } from '@bomb-squad/shared';
import {
  BATTERY_FOOTPRINT,
  INDICATOR_FOOTPRINT,
  PORT_FOOTPRINT,
  SERIAL_STICKER_SIZE,
  computeChassisFeatureLayout,
  type ChassisFeature,
} from './chassis.js';

/**
 * Story 4.2 diegetic bomb metadata: serial sticker, battery panel, indicator
 * chips, port plates — physical chassis features the Defuser finds by rotating
 * the bomb (EXPERIENCE.md "HUD & Diegetic UI"; the mockup's flat top band is a
 * 2D fake — spines win over mocks). Rendering only — zero game logic.
 *
 * Colors are raw hexes (CSS vars can't reach WebGL); token names cited inline.
 * Everything is declarative JSX → R3F auto-disposes geometry/materials.
 */

/** troika-three-text loads ttf/otf/woff — NOT woff2, so the Google Fonts CSS
 *  pipeline is unusable here; this file is vendored (OFL) in public/fonts. */
const MONO_FONT = '/fonts/jetbrains-mono-700.ttf';

/** Mockup `.serial` rotates -1deg; DESIGN.md allows ≤1° paper rotation. */
const STICKER_TILT_RAD = (-1 * Math.PI) / 180;
/** Features sit proud of faces by ~0.01 to avoid z-fighting. */
const SURFACE_OFFSET = 0.01;

const INK = '#211A12'; // mockup serial ink on cream
const CREAM = '#E8DCC2'; // --color-cream
const GRAPHITE = '#1A1A1F'; // --color-graphite
const LABEL_MUTED = '#8A7A5E'; // mockup .serial .lab
const LED_LIT = '#FFF4D6'; // mockup .ind-led.lit
const LED_LIT_GLOW = '#FFE9A8'; // mockup .ind-led.lit box-shadow
const LED_UNLIT = '#3A3A40'; // mockup .ind-led.unlit
const BATTERY_BRASS = '#C9A23A'; // mockup .cell-bat gradient top
const PORT_INSET = '#0C0B0E'; // mockup bay border — deep recess black

/** Barcode-bars flourish under the serial (mockup .serial .bars): fixed
 *  decorative stripe pattern [width, xCenter] in sticker-local units. */
const BARCODE_BARS: ReadonlyArray<[number, number]> = [
  [0.02, -0.3], [0.01, -0.25], [0.02, -0.19], [0.01, -0.12], [0.03, -0.05],
  [0.01, 0.02], [0.02, 0.08], [0.01, 0.13], [0.02, 0.2], [0.01, 0.26], [0.02, 0.31],
];

function SerialSticker({
  position,
  serialNumber,
}: {
  position: [number, number, number];
  serialNumber: string;
}) {
  const [x, y, z] = position;
  const [stickerW, stickerH] = SERIAL_STICKER_SIZE;
  return (
    // Rotate the +z-facing group to face +x (right end face), then tilt -1°
    // around the face normal for the paper-sticker read.
    // Offset by the full SURFACE_OFFSET (not half): the sticker box is
    // SURFACE_OFFSET deep, so half would leave its back face coplanar with the
    // +x chassis surface (z-fighting). Full offset lifts the back face clear.
    <group position={[x + SURFACE_OFFSET, y, z]} rotation={[0, Math.PI / 2, 0]}>
      <group rotation={[0, 0, STICKER_TILT_RAD]}>
        <mesh>
          <boxGeometry args={[stickerW, stickerH, SURFACE_OFFSET]} />
          <meshStandardMaterial color={CREAM} />
        </mesh>
        <Text
          font={MONO_FONT}
          fontSize={0.045}
          letterSpacing={0.22}
          color={LABEL_MUTED}
          anchorX="center"
          anchorY="middle"
          position={[0, 0.155, SURFACE_OFFSET]}
        >
          SERIAL NO.
        </Text>
        <Text
          font={MONO_FONT}
          fontSize={0.16}
          letterSpacing={0.16}
          color={INK}
          anchorX="center"
          anchorY="middle"
          position={[0, 0.015, SURFACE_OFFSET]}
        >
          {serialNumber}
        </Text>
        {BARCODE_BARS.map(([w, cx], i) => (
          <mesh key={i} position={[cx, -0.155, SURFACE_OFFSET / 2 + 0.002]}>
            <boxGeometry args={[w, 0.05, 0.004]} />
            <meshStandardMaterial color={INK} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Memoized per-chip: chips re-render on every store broadcast otherwise. */
const IndicatorChip = memo(function IndicatorChip({
  feature,
  label,
  lit,
}: {
  feature: ChassisFeature;
  label: IndicatorLabel;
  lit: boolean;
}) {
  const [x, y, z] = feature.position;
  const [chipW, chipD] = INDICATOR_FOOTPRINT;
  const chipH = 0.03;
  return (
    <group position={[x, y + chipH / 2, z]}>
      <mesh>
        <boxGeometry args={[chipW, chipH, chipD]} />
        <meshStandardMaterial color={GRAPHITE} />
      </mesh>
      {/* LED dot: lit = warm-white static emissive (no pulse — nothing in this
          story animates, which keeps prefers-reduced-motion trivially satisfied). */}
      <mesh position={[-chipW / 2 + 0.06, chipH / 2 + 0.005, 0]}>
        <cylinderGeometry args={[0.028, 0.028, 0.012, 16]} />
        {lit ? (
          <meshStandardMaterial color={LED_LIT} emissive={LED_LIT_GLOW} emissiveIntensity={1.4} />
        ) : (
          <meshStandardMaterial color={LED_UNLIT} />
        )}
      </mesh>
      <Text
        font={MONO_FONT}
        fontSize={0.07}
        letterSpacing={0.1}
        color={CREAM}
        anchorX="center"
        anchorY="middle"
        // Lying flat on the top face, top of glyphs pointing -z: reads
        // correctly from the front-top overview.
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0.045, chipH / 2 + 0.005, 0]}
      >
        {label}
      </Text>
    </group>
  );
});

function BatteryPanel({
  cells,
  tray,
}: {
  cells: ChassisFeature[];
  tray: { position: [number, number, number]; size: [number, number] } | null;
}) {
  if (!tray) return null;
  const trayH = 0.05;
  const cellRadius = BATTERY_FOOTPRINT[0] / 2 - 0.005;
  const cellLength = BATTERY_FOOTPRINT[1] - 0.02;
  return (
    <group>
      <mesh position={[tray.position[0], tray.position[1] + trayH / 2, tray.position[2]]}>
        <boxGeometry args={[tray.size[0], trayH, tray.size[1]]} />
        <meshStandardMaterial color={GRAPHITE} />
      </mesh>
      {cells.map((cell) => (
        // AA cell lying along z, half-sunk into the tray.
        <mesh
          key={cell.index}
          position={[cell.position[0], cell.position[1] + trayH + 0.01, cell.position[2]]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[cellRadius, cellRadius, cellLength, 16]} />
          <meshStandardMaterial color={BATTERY_BRASS} />
        </mesh>
      ))}
    </group>
  );
}

/** Crude distinct-silhouette inset per port type; the mono label is the
 *  load-bearing identifier (module rules reference ports by name). */
function PortInset({ type }: { type: PortType }) {
  switch (type) {
    case 'PS/2':
      return (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.012, 16]} />
          <meshStandardMaterial color={PORT_INSET} />
        </mesh>
      );
    case 'Stereo RCA':
      return (
        <group>
          {[-0.06, 0.06].map((cx) => (
            <mesh key={cx} position={[cx, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.035, 0.035, 0.012, 16]} />
              <meshStandardMaterial color={PORT_INSET} />
            </mesh>
          ))}
        </group>
      );
    default: {
      // Rectangular slots, width keyed by type for distinct reads.
      const widths: Partial<Record<PortType, [number, number]>> = {
        'DVI-D': [0.26, 0.07],
        Parallel: [0.3, 0.06],
        'RJ-45': [0.1, 0.08],
        Serial: [0.2, 0.06],
      };
      const [w, d] = widths[type] ?? [0.2, 0.06];
      return (
        <mesh>
          <boxGeometry args={[w, 0.012, d]} />
          <meshStandardMaterial color={PORT_INSET} />
        </mesh>
      );
    }
  }
}

const PortPlate = memo(function PortPlate({
  feature,
  type,
}: {
  feature: ChassisFeature;
  type: PortType;
}) {
  const [x, y, z] = feature.position;
  const [plateW, plateD] = PORT_FOOTPRINT;
  const plateH = 0.025;
  return (
    // Bottom face: plate extends downward (-y); label/inset face -y.
    <group position={[x, y - plateH / 2, z]}>
      <mesh>
        <boxGeometry args={[plateW, plateH, plateD]} />
        <meshStandardMaterial color={GRAPHITE} />
      </mesh>
      <group position={[0, -plateH / 2 - 0.006, -0.05]}>
        <PortInset type={type} />
      </group>
      <Text
        font={MONO_FONT}
        fontSize={0.055}
        letterSpacing={0.08}
        color={CREAM}
        anchorX="center"
        anchorY="middle"
        // Lying flat on the bottom face, readable when viewed from below.
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, -plateH / 2 - 0.006, 0.09]}
      >
        {type}
      </Text>
    </group>
  );
});

/**
 * Memoized against unrelated store broadcasts: BombContext is readonly and
 * replaced wholesale on setBomb, so reference equality holds between bombs.
 * No click handlers anywhere — module focus clicks are the scene's only
 * interaction (Story 4.1 contract); raycast hits on metadata are no-ops.
 */
export const ChassisFeatures = memo(function ChassisFeatures({
  context,
}: {
  context: BombContext;
}) {
  const layout = useMemo(
    () =>
      computeChassisFeatureLayout({
        batteryCount: context.batteryCount,
        indicatorCount: context.indicators.length,
        portCount: context.ports.length,
      }),
    [context],
  );

  return (
    <group>
      <SerialSticker position={layout.serial.position} serialNumber={context.serialNumber} />
      <BatteryPanel cells={layout.batteries} tray={layout.batteryTray} />
      {layout.indicators.map((feature) => {
        const indicator = context.indicators[feature.index];
        return indicator ? (
          <IndicatorChip
            key={feature.index}
            feature={feature}
            label={indicator.label}
            lit={indicator.lit}
          />
        ) : null;
      })}
      {layout.ports.map((feature) => {
        const port = context.ports[feature.index];
        return port ? <PortPlate key={feature.index} feature={feature} type={port} /> : null;
      })}
    </group>
  );
});
