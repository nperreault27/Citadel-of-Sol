import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CombatScreen } from '@/ui/combat/CombatScreen';
import { combatStore } from '@/state/combatStore';
import { gameStore } from '@/state/store';
import { COMBAT_CONTENT, defaultDeck } from '@/game/combat/content';
import { cardDefOf, cardPower } from '@/game/combat/engine';
import { mitigation } from '@/game/combat/stats';

const PARTY = ['ivy', 'saber', 'cask'];

const initialGame = gameStore.getState();

beforeEach(() => {
  gameStore.setState(initialGame, true);
  gameStore.getState().setParty([...PARTY]);
  gameStore.getState().setDeck(defaultDeck(PARTY));
  combatStore.getState().endBattle();
});

function battle() {
  const current = combatStore.getState().battle;
  if (!current) throw new Error('no battle');
  return current;
}

/** The nth enemy panel in the arena, in display order. */
function enemyPanel(container: HTMLElement, index = 0): HTMLElement {
  const panels = container.querySelectorAll('.combat__enemies .unit');
  const panel = panels[index];
  if (!panel) throw new Error(`no enemy panel at ${index}`);
  return panel as HTMLElement;
}

function sheet(container: HTMLElement): HTMLElement | null {
  return container.querySelector('.sheet');
}

/**
 * Puts a card in the air, aimed at the enemy row.
 *
 * Set rather than played, so the test doesn't depend on which cards the seed
 * happens to deal into the opening hand.
 */
function aimAtEnemies(): void {
  const current = battle();

  const pending = current.hand.find((instanceId) => {
    const def = cardDefOf(current, COMBAT_CONTENT, instanceId);
    return def?.target === 'oneEnemy';
  });

  if (!pending) throw new Error('no enemy-targeting card in hand');
  combatStore.setState({ battle: { ...current, phase: 'selectTarget', pendingCard: pending } });
}

describe('reading an enemy', () => {
  it('opens its move list on a tap, when there is nothing to aim', async () => {
    const user = userEvent.setup();
    combatStore.getState().startBattle(7);
    const { container } = render(<CombatScreen />);

    expect(sheet(container)).toBeNull();
    await user.click(enemyPanel(container));

    // The Ogre leads the enemy order, and both its moves are on the sheet.
    expect(screen.getByText('Smash')).toBeInTheDocument();
    expect(screen.getByText('Sweep')).toBeInTheDocument();
  });

  it('draws each move as a card, rules text and all', async () => {
    const user = userEvent.setup();
    combatStore.getState().startBattle(7);
    const { container } = render(<CombatScreen />);

    await user.click(enemyPanel(container));
    const moves = container.querySelectorAll('.sheet__moves .card');
    expect(moves).toHaveLength(2);

    // The full description, not a brief — this screen is for studying.
    expect(screen.getByText('Deal heavy damage to one of your party.')).toBeInTheDocument();
    expect(screen.getByText('Deal damage to your whole party.')).toBeInTheDocument();
  });

  it('reports Power the same way a player card does', async () => {
    const user = userEvent.setup();
    combatStore.getState().startBattle(7);
    const { container } = render(<CombatScreen />);

    await user.click(enemyPanel(container));

    // Power is a percentage of the user's Attack whoever is holding the card,
    // so the Ogre's number means what Bruno's would. Read off content rather
    // than pinned here, so a tuning pass lands on the moves and not on this.
    const [smash, sweep] = COMBAT_CONTENT.enemyActions['ogre'] ?? [];
    if (!smash || !sweep) throw new Error('no ogre moves');

    expect(screen.getByText(`Power ${cardPower(smash)}`)).toBeInTheDocument();
    expect(screen.getByText(`Power ${cardPower(sweep)}`)).toBeInTheDocument();
  });

  it('says how often each move comes up', async () => {
    const user = userEvent.setup();
    combatStore.getState().startBattle(7);
    const { container } = render(<CombatScreen />);

    await user.click(enemyPanel(container));

    // Weights 3 and 1: three Smashes to a Sweep. This is the whole reason to
    // open the sheet, and it is scouting rather than a telegraphed intent —
    // the engine still picks the move at the moment it acts.
    const panel = sheet(container) as HTMLElement;
    expect(within(panel).getByText('75%')).toBeInTheDocument();
    expect(within(panel).getByText('25%')).toBeInTheDocument();
  });

  it('explains the keywords its moves use, once each', async () => {
    const user = userEvent.setup();
    combatStore.getState().startBattle(7);
    const { container } = render(<CombatScreen />);

    // An Imp, whose Jinx applies Weakness. The Ogre only hits, so it has no
    // glossary at all.
    await user.click(enemyPanel(container, 1));

    const panel = sheet(container) as HTMLElement;
    expect(within(panel).getAllByText('Weakness')).toHaveLength(1);
    expect(within(panel).getByText(/Reduces this character/)).toBeInTheDocument();
  });

  it('shows stats the arena panel has no room for', async () => {
    const user = userEvent.setup();
    combatStore.getState().startBattle(7);
    const { container } = render(<CombatScreen />);

    await user.click(enemyPanel(container));
    const panel = sheet(container) as HTMLElement;

    expect(within(panel).getByText('DEF')).toBeInTheDocument();
    expect(within(panel).getByText('40')).toBeInTheDocument();
    // Defense means nothing without the curve behind it, so the sheet prints
    // what the number actually buys rather than the number alone.
    const taken = Math.round(mitigation(40) * 100);
    expect(within(panel).getByText(`takes ${taken}%`)).toBeInTheDocument();
  });

  it('reports Attack after the statuses bending it, not as printed', async () => {
    const user = userEvent.setup();
    combatStore.getState().startBattle(7);

    const current = battle();
    const id = current.enemyOrder[0];
    if (!id) throw new Error('no enemy');
    const ogre = current.combatants[id];
    if (!ogre) throw new Error('no ogre');

    combatStore.setState({
      battle: {
        ...current,
        combatants: {
          ...current.combatants,
          [id]: {
            ...ogre,
            statuses: [{ kind: 'weakness', stacks: 1, duration: { kind: 'permanent' } }],
          },
        },
      },
    });

    const { container } = render(<CombatScreen />);
    await user.click(enemyPanel(container));

    // 110 Attack at 0.7 is 77. A Weakened Ogre still advertising 110 would be
    // answering a question nobody asked.
    const panel = sheet(container) as HTMLElement;
    expect(within(panel).getByText('77')).toBeInTheDocument();
    expect(within(panel).queryByText('110')).toBeNull();
  });

  it('closes on a tap outside it', async () => {
    const user = userEvent.setup();
    combatStore.getState().startBattle(7);
    const { container } = render(<CombatScreen />);

    await user.click(enemyPanel(container));
    fireEvent.pointerDown(sheet(container) as HTMLElement);

    expect(sheet(container)).toBeNull();
  });

  it('stays open when the tap lands on what the player is reading', async () => {
    const user = userEvent.setup();
    combatStore.getState().startBattle(7);
    const { container } = render(<CombatScreen />);

    await user.click(enemyPanel(container));
    fireEvent.pointerDown(container.querySelector('.sheet__moves .card') as HTMLElement);

    // The sheet scrolls, and a flick that starts on a card must not close it.
    expect(sheet(container)).not.toBeNull();
  });

  it('follows the enemy as the fight moves under it', async () => {
    const user = userEvent.setup();
    combatStore.getState().startBattle(7);
    const { container } = render(<CombatScreen />);

    await user.click(enemyPanel(container));
    expect(screen.getByText('400/400 HP')).toBeInTheDocument();

    const current = battle();
    const id = current.enemyOrder[0];
    if (!id) throw new Error('no enemy');
    const ogre = current.combatants[id];
    if (!ogre) throw new Error('no ogre');

    combatStore.setState({
      battle: { ...current, combatants: { ...current.combatants, [id]: { ...ogre, health: 260 } } },
    });

    // The sheet holds an id, not the combatant it was opened with — one that
    // kept the object would sit there quoting health from three hits ago.
    await waitFor(() => expect(screen.getByText('260/400 HP')).toBeInTheDocument());
  });
});

describe('reading without losing the turn', () => {
  it('aims at an enemy that is a legal target, rather than reading it', async () => {
    const user = userEvent.setup();
    combatStore.getState().startBattle(7);
    aimAtEnemies();
    const { container } = render(<CombatScreen />);

    await user.click(enemyPanel(container));

    // A tap while a card is in the air is the aim it has always been.
    expect(sheet(container)).toBeNull();
    expect(combatStore.getState().battle?.phase).not.toBe('selectTarget');
  });

  it('still reads on a hold, and keeps the card pointed', async () => {
    combatStore.getState().startBattle(7);
    aimAtEnemies();
    const pending = battle().pendingCard;
    const { container } = render(<CombatScreen />);

    const panel = enemyPanel(container);
    fireEvent.pointerDown(panel, { clientX: 40, clientY: 40 });
    await waitFor(() => expect(sheet(container)).not.toBeNull());
    fireEvent.pointerUp(panel);
    fireEvent.click(panel);

    // Checking what an enemy can do is exactly what a player wants mid-decision,
    // and it must not cost them the card they were pointing.
    expect(sheet(container)).not.toBeNull();
    expect(combatStore.getState().battle?.phase).toBe('selectTarget');
    expect(combatStore.getState().battle?.pendingCard).toBe(pending);
  });

  it('leaves the party alone — their cards are the hand', async () => {
    const user = userEvent.setup();
    combatStore.getState().startBattle(7);
    const { container } = render(<CombatScreen />);

    const ally = container.querySelector('.combat__party .unit') as HTMLElement;
    await user.click(ally);

    expect(sheet(container)).toBeNull();
  });

  it('does not open the sheet when the press was meant for a status badge', async () => {
    const user = userEvent.setup();
    combatStore.getState().startBattle(7);

    const current = battle();
    const id = current.enemyOrder[0];
    if (!id) throw new Error('no enemy');
    const ogre = current.combatants[id];
    if (!ogre) throw new Error('no ogre');

    combatStore.setState({
      battle: {
        ...current,
        combatants: {
          ...current.combatants,
          [id]: {
            ...ogre,
            statuses: [{ kind: 'poison', stacks: 2, duration: { kind: 'turns', remaining: 2 } }],
          },
        },
      },
    });

    const { container } = render(<CombatScreen />);
    const badge = container.querySelector('.combat__enemies .status') as HTMLElement;

    fireEvent.pointerDown(badge, { clientX: 40, clientY: 40 });
    await user.click(badge);

    // The badge asked for its own label, and got it without the sheet landing
    // on top of it.
    expect(sheet(container)).toBeNull();
    expect(screen.getByText('Poison, 2 stacks, 2 turns remaining')).toBeInTheDocument();
  });
});
