import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UIOverlay } from '@/ui/UIOverlay';
import { gameStore } from '@/state/store';
import { combatStore } from '@/state/combatStore';

/**
 * The navigation path a player actually takes: Arena, pick a party, build a
 * deck, fight. Every screen was unit tested in isolation and every one of them
 * passed while this route was broken, which is exactly why it is worth walking
 * end to end.
 */

const initialGame = gameStore.getState();

beforeEach(() => {
  gameStore.setState(initialGame, true);
  gameStore.getState().setPhase('playing');
  gameStore.getState().setParty(['ivy', 'saber', 'cask']);
  gameStore.getState().setDeck({});
  combatStore.getState().endBattle();
});

describe('pre-battle flow', () => {
  it('opens the roster from the Arena button', async () => {
    const user = userEvent.setup();
    render(<UIOverlay />);

    await user.click(screen.getByRole('button', { name: 'Arena' }));

    expect(screen.getByText('Choose your party')).toBeInTheDocument();
  });

  it('reaches the deck builder from the roster', async () => {
    const user = userEvent.setup();
    render(<UIOverlay />);

    await user.click(screen.getByRole('button', { name: 'Arena' }));
    await user.click(screen.getByRole('button', { name: 'Build deck' }));

    expect(screen.getByText('Build your deck')).toBeInTheDocument();
  });

  it('goes back from the deck builder to the roster', async () => {
    const user = userEvent.setup();
    render(<UIOverlay />);

    await user.click(screen.getByRole('button', { name: 'Arena' }));
    await user.click(screen.getByRole('button', { name: 'Build deck' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByText('Choose your party')).toBeInTheDocument();
  });

  it('closes the roster entirely', async () => {
    const user = userEvent.setup();
    render(<UIOverlay />);

    await user.click(screen.getByRole('button', { name: 'Arena' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.queryByText('Choose your party')).toBeNull();
    expect(screen.getByRole('button', { name: 'Arena' })).toBeInTheDocument();
  });

  it('blocks Build deck with nobody equipped', async () => {
    gameStore.getState().setParty([]);

    const user = userEvent.setup();
    render(<UIOverlay />);

    await user.click(screen.getByRole('button', { name: 'Arena' }));
    expect(screen.getByRole('button', { name: 'Build deck' })).toBeDisabled();
  });

  it('starts a battle once the deck is legal, replacing the prep screens', async () => {
    const { defaultDeck } = await import('@/game/combat/content');
    gameStore.getState().setDeck(defaultDeck(['ivy', 'saber', 'cask']));

    const user = userEvent.setup();
    render(<UIOverlay />);

    await user.click(screen.getByRole('button', { name: 'Arena' }));
    await user.click(screen.getByRole('button', { name: 'Build deck' }));
    await user.click(screen.getByRole('button', { name: 'Fight' }));

    expect(combatStore.getState().battle).not.toBeNull();
    expect(screen.queryByText('Build your deck')).toBeNull();
  });
});
