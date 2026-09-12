import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UIOverlay } from '@/ui/UIOverlay';
import { gameStore } from '@/state/store';
import { combatStore } from '@/state/combatStore';
import { DEFAULT_ENCOUNTER, ENEMY_TEAMS } from '@/game/combat/content';

/**
 * The navigation path a player actually takes: Arena, pick a fight, pick a
 * party, build a deck, fight. Every screen was unit tested in isolation and
 * every one of them passed while this route was broken, which is exactly why it
 * is worth walking end to end.
 */

const initialGame = gameStore.getState();

beforeEach(() => {
  gameStore.setState(initialGame, true);
  gameStore.getState().setPhase('playing');
  gameStore.getState().setParty(['ivy', 'saber', 'cask']);
  gameStore.getState().setDeck({});
  gameStore.getState().setEncounter(DEFAULT_ENCOUNTER);
  combatStore.getState().endBattle();
});

/** Opens the Arena and walks as far as the party screen. */
async function toRoster(user: ReturnType<typeof userEvent.setup>, team = 'Ogre and Imps') {
  await user.click(screen.getByRole('button', { name: 'Arena' }));
  await user.click(screen.getByRole('button', { name: new RegExp(team) }));
}

describe('pre-battle flow', () => {
  it('opens the fight picker from the Arena button', async () => {
    const user = userEvent.setup();
    render(<UIOverlay />);

    await user.click(screen.getByRole('button', { name: 'Arena' }));

    // The opposition is chosen before the party, because who to bring is an
    // answer to what you are facing.
    expect(screen.getByText('Choose your fight')).toBeInTheDocument();
    expect(screen.queryByText('Choose your party')).toBeNull();
  });

  it('offers every team, grouped by tier', async () => {
    const user = userEvent.setup();
    render(<UIOverlay />);

    await user.click(screen.getByRole('button', { name: 'Arena' }));

    for (const team of ENEMY_TEAMS) {
      expect(screen.getByRole('button', { name: new RegExp(team.name) })).toBeInTheDocument();
    }
    expect(screen.getByText('The Proving Ground')).toBeInTheDocument();
    expect(screen.getByText('Capstone')).toBeInTheDocument();
  });

  it('reaches the roster by choosing a fight', async () => {
    const user = userEvent.setup();
    render(<UIOverlay />);

    await toRoster(user);

    expect(screen.getByText('Choose your party')).toBeInTheDocument();
  });

  it('remembers which fight was chosen', async () => {
    const user = userEvent.setup();
    render(<UIOverlay />);

    await toRoster(user, 'Ratkin Pack');

    expect(gameStore.getState().encounter).toBe('pack');
    // And says so on the screen that follows, so the party is chosen with the
    // fight still in view.
    expect(screen.getByText('Ratkin Pack')).toBeInTheDocument();
  });

  it('carries the chosen fight into the battle it starts', async () => {
    const { defaultDeck } = await import('@/game/combat/content');
    gameStore.getState().setDeck(defaultDeck(['ivy', 'saber', 'cask']));

    const user = userEvent.setup();
    render(<UIOverlay />);

    await toRoster(user, 'Ratkin Pack');
    await user.click(screen.getByRole('button', { name: 'Build deck' }));
    await user.click(screen.getByRole('button', { name: 'Fight' }));

    const battle = combatStore.getState().battle;
    expect(battle).not.toBeNull();
    // Five Ratkin, not the Ogre and its imps.
    expect(battle!.enemyOrder).toHaveLength(5);
    for (const id of battle!.enemyOrder) {
      expect(battle!.combatants[id]!.archetype).toBe('ratkin');
    }
  });

  it('restarts the same fight, not the default one', async () => {
    const { defaultDeck } = await import('@/game/combat/content');
    gameStore.getState().setDeck(defaultDeck(['ivy', 'saber', 'cask']));

    const user = userEvent.setup();
    render(<UIOverlay />);

    await toRoster(user, 'The Hexweavers');
    await user.click(screen.getByRole('button', { name: 'Build deck' }));
    await user.click(screen.getByRole('button', { name: 'Fight' }));

    // "Fight again" on the victory banner runs long after the picker is gone,
    // which is the whole reason the choice lives in the store rather than in
    // the screen that made it.
    combatStore.getState().startBattle();

    const battle = combatStore.getState().battle!;
    for (const id of battle.enemyOrder) {
      expect(battle.combatants[id]!.archetype).toBe('hexweaver');
    }
  });

  it('lets the player scout an enemy before committing to the fight', async () => {
    const user = userEvent.setup();
    render(<UIOverlay />);

    await user.click(screen.getByRole('button', { name: 'Arena' }));

    const row = screen.getByRole('button', { name: /Ogre and Imps/ });
    await user.click(within(row).getByText('Ogre'));

    // The move sheet, without having chosen the fight — reading the opposition
    // is the point of picking it first.
    expect(screen.getByText('Smash')).toBeInTheDocument();
    expect(screen.getByText('Deal heavy damage to one of your party.')).toBeInTheDocument();
    expect(screen.getByText('Choose your fight')).toBeInTheDocument();
  });

  it('does not choose the fight when the tap was meant to scout one of its enemies', async () => {
    const user = userEvent.setup();
    render(<UIOverlay />);

    await user.click(screen.getByRole('button', { name: 'Arena' }));

    const row = screen.getByRole('button', { name: /Ratkin Pack/ });
    await user.click(within(row).getByText('Ratkin 1'));

    expect(gameStore.getState().encounter).toBe(DEFAULT_ENCOUNTER);
    expect(screen.queryByText('Choose your party')).toBeNull();
  });

  it('reaches the deck builder from the roster', async () => {
    const user = userEvent.setup();
    render(<UIOverlay />);

    await toRoster(user);
    await user.click(screen.getByRole('button', { name: 'Build deck' }));

    expect(screen.getByText('Build your deck')).toBeInTheDocument();
  });

  it('goes back from the deck builder to the roster', async () => {
    const user = userEvent.setup();
    render(<UIOverlay />);

    await toRoster(user);
    await user.click(screen.getByRole('button', { name: 'Build deck' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByText('Choose your party')).toBeInTheDocument();
  });

  it('goes back from the roster to the fight picker', async () => {
    const user = userEvent.setup();
    render(<UIOverlay />);

    await toRoster(user);
    await user.click(screen.getByRole('button', { name: 'Back' }));

    // Back walks the route in reverse rather than dumping the player out of it.
    expect(screen.getByText('Choose your fight')).toBeInTheDocument();
  });

  it('closes the prep screens entirely from the fight picker', async () => {
    const user = userEvent.setup();
    render(<UIOverlay />);

    await user.click(screen.getByRole('button', { name: 'Arena' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.queryByText('Choose your fight')).toBeNull();
    expect(screen.getByRole('button', { name: 'Arena' })).toBeInTheDocument();
  });

  it('blocks Build deck with nobody equipped', async () => {
    gameStore.getState().setParty([]);

    const user = userEvent.setup();
    render(<UIOverlay />);

    await toRoster(user);
    expect(screen.getByRole('button', { name: 'Build deck' })).toBeDisabled();
  });

  it('starts a battle once the deck is legal, replacing the prep screens', async () => {
    const { defaultDeck } = await import('@/game/combat/content');
    gameStore.getState().setDeck(defaultDeck(['ivy', 'saber', 'cask']));

    const user = userEvent.setup();
    render(<UIOverlay />);

    await toRoster(user);
    await user.click(screen.getByRole('button', { name: 'Build deck' }));
    await user.click(screen.getByRole('button', { name: 'Fight' }));

    expect(combatStore.getState().battle).not.toBeNull();
    expect(screen.queryByText('Build your deck')).toBeNull();
  });
});
