/**
 * Module contract file: types re-exported from packages/shared — NEVER
 * duplicated (project rule). The shared dir is the single source of truth;
 * this file exists so the per-module directory is self-contained for readers.
 */
export {
  PASSWORDS_MODULE_ID,
  PASSWORD_WORDS,
  COLUMN_COUNT,
  LETTERS_PER_COLUMN,
  isPasswordsAction,
  type PasswordWord,
  type PasswordsState,
  type PasswordsAction,
  type PasswordsReset,
} from '@bomb-squad/shared';
