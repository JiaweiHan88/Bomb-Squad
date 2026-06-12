import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const base =
  'inline-flex items-center justify-center gap-2.5 whitespace-nowrap rounded-md font-body ' +
  'font-semibold text-base cursor-pointer border-2 transition-[transform,background,box-shadow] ' +
  'duration-100 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Per-variant styling, mapped 1:1 from tokens.css `.btn-*`.
 *
 * The tactile 2px press (`active:translate-y-0.5` + shadow drop) is PRIMARY ONLY
 * — DESIGN.md: "the only place we use a tactile press effect." Under
 * prefers-reduced-motion the ~100ms transform still snaps; no extra animation.
 */
const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-bakelite text-cream border-bakelite-deep px-5 py-3 ' +
    'shadow-[var(--btn-primary-shadow)] hover:bg-[#D85A2A] ' +
    'active:translate-y-0.5 active:shadow-none',
  secondary:
    'bg-transparent text-ink-primary border-ink-muted px-[18px] py-2.5 hover:border-ink-primary',
  danger: 'bg-led-red text-white border-[#B31515] px-5 py-3',
};

/**
 * Operator-world button.
 *
 * `primary` is for safe / forward actions ONLY. Destructive or irreversible
 * actions must NEVER use a primary button (AC2) — route them through
 * {@link ConfirmButton}, whose action step uses the `danger` variant.
 */
export default function Button({ variant = 'primary', className, ...rest }: ButtonProps) {
  const classes = `${base} ${variants[variant]}${className != null ? ` ${className}` : ''}`;
  return <button className={classes} {...rest} />;
}
