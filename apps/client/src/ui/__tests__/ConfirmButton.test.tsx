import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ConfirmButton from '../ConfirmButton.js';

describe('ConfirmButton', () => {
  it('renders the resting label and no confirm/cancel until armed', () => {
    render(<ConfirmButton label="Remove" onConfirm={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('arms on the first click (reveals Confirm + Cancel) without firing onConfirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Remove" onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('fires onConfirm only on the second (Confirm) click', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Remove" onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    // Disarms back to the resting button afterwards.
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('fires onConfirm at most once even if Confirm is clicked twice before re-render', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Remove" onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    // Two synchronous clicks (no React re-render between) exercise the firedRef guard.
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disarms on Cancel without firing onConfirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Remove" onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  it('disarms on Escape without firing onConfirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Remove" onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.keyboard('{Escape}');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});
