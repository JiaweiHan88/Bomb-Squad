/**
 * Module contract file: types re-exported from packages/shared — NEVER
 * duplicated (project rule). The shared dir is the single source of truth;
 * this file exists so the per-module directory is self-contained for readers.
 */
export {
  WIRES_MODULE_ID,
  WIRE_COLORS,
  WIRE_COLOR_LABELS,
  isWiresAction,
  type WireColor,
  type WiresAction,
  type WiresReset,
  type WiresState,
  type WiresWire,
} from '@bomb-squad/shared';
