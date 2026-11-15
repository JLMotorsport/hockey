import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ConfirmTransfersButton } from '@/features/squad/SquadScreen';

const setup = (cost: number) => {
  const onConfirm = vi.fn();
  render(
    <ConfirmTransfersButton
      cost={cost}
      disabled={false}
      label="Confirm Transfers"
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
};

describe('Confirm Transfers', () => {
  it('saves straight away when the transfers are free', async () => {
    const onConfirm = setup(0);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm Transfers' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks first when they cost points, and No goes back without saving', async () => {
    const onConfirm = setup(8);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm Transfers' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      "These transfers will cost you 8 points off this gameweek's score.",
    );
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'No, go back' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Yes makes the transfers', async () => {
    const onConfirm = setup(4);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm Transfers' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, make the transfers' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
