/**
 * Module contract file: types re-exported from packages/shared — NEVER
 * duplicated (project rule). The shared dir is the single source of truth;
 * this file exists so the per-module directory is self-contained for readers.
 */
export {
  BUTTON_MODULE_ID,
  BUTTON_COLORS,
  BUTTON_LABELS,
  STRIP_COLORS,
  BUTTON_COLOR_LABELS,
  isButtonAction,
  type ButtonColor,
  type ButtonLabel,
  type StripColor,
  type ButtonState,
  type ButtonAction,
  type ButtonReset,
} from '@bomb-squad/shared';
