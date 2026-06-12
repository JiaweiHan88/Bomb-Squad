import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const base =
  'inline-flex items-center justify-center gap-2.5 whitespace-nowrap rounded-md font-body ' +
  'font-semibold text-base cursor-pointer border-2 ' +
  '[transition:transform_.04s_ease,background_.15s_ease,box-shadow_.12s_ease] ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Per-variant styling, mapped 1:1 from tokens.css `.btn-*` — paddings and the
 * press offset are literal px (not rem-derived) so they hold at any root font size.
 *
 * The tactile 2px press (`active:translate-y-[2px]` + shadow drop) is PRIMARY ONLY
 * — DESIGN.md: "the only place we use a tactile press effect." Under
 * prefers-reduced-motion the 40ms transform reads as an instant snap; no extra
 * animation needed.
 */
const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-bakelite text-cream border-bakelite-deep px-[20px] py-[12px] ' +
    'shadow-[var(--btn-primary-shadow)] hover:bg-[#D85A2A] ' +
    'active:translate-y-[2px] active:shadow-none',
  secondary:
    'bg-transparent text-ink-primary border-ink-muted px-[18px] py-[10px] hover:border-ink-primary',
  danger: 'bg-led-red text-white border-[#B31515] px-[20px] py-[12px]',
};

/**
 * Operator-world button.
 *
 * `primary` is for safe / forward actions ONLY. Destructive or irreversible
 * actions must NEVER use a primary button (AC2) — route them through
 * {@link ConfirmButton}, whose action step uses the `danger` variant.
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', className, ...rest },
  ref,
) {
  const classes = `${base} ${variants[variant]}${className != null ? ` ${className}` : ''}`;
  return <button ref={ref} className={classes} {...rest} />;
});

export default Button;
