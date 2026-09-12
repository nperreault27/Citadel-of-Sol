import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CombatScreen } from '@/ui/combat/CombatScreen';
import { cardColumns } from '@/ui/combat/cardRows';
import { combatStore } from '@/state/combatStore';
import { gameStore } from '@/state/store';
import { COMBAT_CONTENT, defaultDeck } from '@/game/combat/content';
import { cardDefOf } from '@/game/combat/engine';

const PARTY = ['ivy', 'saber', 'cask'];

const initialGame = gameStore.getState();

beforeEach(() => {
  gameStore.setState(initialGame, true);
  gameStore.getState().setParty([...PARTY]);
  gameStore.getState().setDeck(defaultDeck(PARTY));
  combatStore.getState().endBattle();
});

/** The definition behind the first card in hand. */
function firstInHand() {
  const battle = combatStore.getState().battle;
  if (!battle) throw new Error('no battle');
  const def = cardDefOf(battle, COMBAT_CONTENT, battle.hand[0]!);
  if (!def) throw new Error('no card');
  return def;
}

describe('cardColumns', () => {
  it('keeps a legal hand on one row', () => {
    expect(cardColumns(5)).toBe(5);
    expect(cardColumns(3)).toBe(3);
  });

  it('splits an over-full hand evenly rather than stranding one card', () => {
    // A drawn-into sixth card deals as 3 + 3; the alternative, 5 + 1, leaves a
    // lone card on a line of its own.
    expect(cardColumns(6)).toBe(3);
    expect(cardColumns(7)).toBe(4);
    expect(cardColumns(9)).toBe(5);
    expect(cardColumns(11)).toBe(4);
  });

  it('never asks for zero columns, which would divide by nothing in CSS', () => {
    expect(cardColumns(0)).toBe(1);
  });
});

describe('status icons', () => {
  /** A battle where the first party member is poisoned. */
  function battleWithPoison() {
    combatStore.getState().startBattle(7);
    const battle = combatStore.getState().battle;
    if (!battle) throw new Error('no battle');

    const id = battle.playerOrder[0];
    const other = battle.playerOrder[1];
    if (!id || !other) throw new Error('no party');
    const combatant = battle.combatants[id];
    const second = battle.combatants[other];
    if (!combatant || !second) throw new Error('no combatant');

    combatStore.setState({
      battle: {
        ...battle,
        combatants: {
          ...battle.combatants,
          [id]: {
            ...combatant,
            statuses: [{ kind: 'poison', stacks: 2, duration: { kind: 'turns', remaining: 3 } }],
          },
          [other]: {
            ...second,
            statuses: [{ kind: 'bleed', stacks: 1, duration: { kind: 'permanent' } }],
          },
        },
      },
    });
  }

  it('shows its label when tapped, and hides it when tapped again', async () => {
    const user = userEvent.setup();
    battleWithPoison();
    const { container } = render(<CombatScreen />);

    const badge = container.querySelector('.combat__party .status') as HTMLElement;

    // The same text the title carries, which a phone has no hover to show.
    await user.click(badge);
    expect(screen.getByText('Poison, 2 stacks, 3 turns remaining')).toBeInTheDocument();

    await user.click(badge);
    expect(screen.queryByText('Poison, 2 stacks, 3 turns remaining')).toBeNull();
  });

  it('shows one label at a time, wherever the badges are', async () => {
    const user = userEvent.setup();
    battleWithPoison();
    const { container } = render(<CombatScreen />);

    const badges = container.querySelectorAll('.status');
    expect(badges.length).toBeGreaterThan(1);

    await user.click(badges[0] as HTMLElement);
    await user.click(badges[1] as HTMLElement);

    // Opening the second closed the first; two labels at once is two answers to
    // a question the player only asked once.
    expect(container.querySelectorAll('.unit__tip')).toHaveLength(1);
  });

  it('puts the label away on the next press anywhere else', async () => {
    const user = userEvent.setup();
    battleWithPoison();
    const { container } = render(<CombatScreen />);

    await user.click(container.querySelector('.combat__party .status') as HTMLElement);
    expect(container.querySelectorAll('.unit__tip')).toHaveLength(1);

    // Reading is over the moment the player reaches for anything else, and
    // getting back to the fight should not cost a tap of its own.
    await user.click(container.querySelector('.combat__hand') as HTMLElement);
    expect(container.querySelectorAll('.unit__tip')).toHaveLength(0);
  });

  it('does not swallow the press that closes it', async () => {
    const user = userEvent.setup();
    battleWithPoison();
    const { container } = render(<CombatScreen />);

    await user.click(container.querySelector('.combat__party .status') as HTMLElement);
    await user.click(container.querySelector('.combat__hand .card') as HTMLElement);

    expect(container.querySelectorAll('.unit__tip')).toHaveLength(0);

    // The press was watched, not intercepted: the card it was aimed at is
    // either waiting for a target or already resolved.
    const battle = combatStore.getState().battle;
    expect(battle?.phase === 'selectTarget' || battle?.hand.length === 4).toBe(true);
  });

  it('does not aim a card at the fighter the badge belongs to', async () => {
    const user = userEvent.setup();
    battleWithPoison();
    const { container } = render(<CombatScreen />);

    await user.click(container.querySelector('.combat__party .status') as HTMLElement);

    // Reading a status is not choosing a target.
    expect(combatStore.getState().battle?.phase).not.toBe('selectTarget');
    expect(combatStore.getState().battle?.pendingCard).toBeFalsy();
  });
});

describe('picking a card to discard', () => {
  it('offers a line each, not the full rules', () => {
    combatStore.getState().startBattle(7);
    const battle = combatStore.getState().battle;
    if (!battle) throw new Error('no battle');
    const card = firstInHand();

    // The prompt Sift raises, without having to draw into Sift.
    combatStore.setState({
      battle: {
        ...battle,
        phase: 'selecting',
        selection: {
          kind: 'discardOne',
          cards: [...battle.hand],
          drawAfter: 2,
          prompt: 'Discard a card',
        },
      },
    });

    const { container } = render(<CombatScreen />);
    const strip = container.querySelector('.selection__cards') as HTMLElement;

    expect(within(strip).getAllByText(card.brief).length).toBeGreaterThan(0);
    expect(within(strip).queryByText(card.description)).toBeNull();
  });

  it('sizes those cards the same way the deck builder sizes its own', () => {
    combatStore.getState().startBattle(7);
    const battle = combatStore.getState().battle;
    if (!battle) throw new Error('no battle');

    combatStore.setState({
      battle: {
        ...battle,
        phase: 'selecting',
        selection: {
          kind: 'discardOne',
          cards: [...battle.hand],
          drawAfter: 2,
          prompt: 'Discard a card',
        },
      },
    });

    const { container } = render(<CombatScreen />);

    // Same detail level, so the same size class — height follows what the card
    // draws, not which screen it is drawn on.
    const card = container.querySelector('.selection__cards .card') as HTMLElement;
    expect(card.classList.contains('card--brief')).toBe(true);
  });
});

describe('cards in hand', () => {
  it('shows the name but not the rules text', () => {
    combatStore.getState().startBattle(7);
    const card = firstInHand();
    const { container } = render(<CombatScreen />);

    const hand = container.querySelector('.combat__hand') as HTMLElement;
    expect(within(hand).getAllByText(card.name).length).toBeGreaterThan(0);
    expect(within(hand).queryByText(card.description)).toBeNull();
  });

  it('prices itself in badges rather than words', () => {
    combatStore.getState().startBattle(7);
    const { container } = render(<CombatScreen />);

    // No room to name a cost at hand width, so nothing tries to — and nothing
    // abbreviates it either. The hold spells it out.
    const hand = container.querySelector('.combat__hand') as HTMLElement;
    expect(within(hand).queryByText(/stam/i)).toBeNull();
  });

  it('tags a card with its owner, which is what colours it', () => {
    combatStore.getState().startBattle(7);
    const card = firstInHand();
    const { container } = render(<CombatScreen />);

    const button = container.querySelector('.combat__hand .card') as HTMLElement;
    expect(button.getAttribute('data-owner')).toBe(card.ownerId ?? 'team');
  });

  it('opens the full card on a hold and leaves it open', async () => {
    combatStore.getState().startBattle(7);
    const card = firstInHand();
    const { container } = render(<CombatScreen />);

    const button = container.querySelector('.combat__hand .card') as HTMLElement;
    fireEvent.pointerDown(button, { clientX: 40, clientY: 40 });
    await waitFor(() => expect(screen.getByText(card.description)).toBeInTheDocument());

    // Letting go is not the end of reading it — the thumb that opened it is
    // sitting on top of what there is to read.
    fireEvent.pointerUp(button);
    expect(screen.getByText(card.description)).toBeInTheDocument();
  });

  it('puts the card away on the next tap anywhere', async () => {
    combatStore.getState().startBattle(7);
    const card = firstInHand();
    const { container } = render(<CombatScreen />);

    const button = container.querySelector('.combat__hand .card') as HTMLElement;
    fireEvent.pointerDown(button, { clientX: 40, clientY: 40 });
    await waitFor(() => expect(screen.getByText(card.description)).toBeInTheDocument());
    fireEvent.pointerUp(button);

    fireEvent.pointerDown(container.querySelector('.card-detail') as HTMLElement);
    expect(screen.queryByText(card.description)).toBeNull();
  });

  it('does not play the card the player was only reading', async () => {
    combatStore.getState().startBattle(7);
    const card = firstInHand();
    const { container } = render(<CombatScreen />);

    const button = container.querySelector('.combat__hand .card') as HTMLElement;
    fireEvent.pointerDown(button, { clientX: 40, clientY: 40 });
    await waitFor(() => expect(screen.getByText(card.description)).toBeInTheDocument());
    fireEvent.pointerUp(button);
    fireEvent.click(button);

    const battle = combatStore.getState().battle;
    expect(battle?.pendingCard).toBeFalsy();
    expect(battle?.hand).toHaveLength(5);
  });

  it('still plays on a plain tap', () => {
    combatStore.getState().startBattle(7);
    const { container } = render(<CombatScreen />);

    const button = container.querySelector('.combat__hand .card') as HTMLElement;
    fireEvent.pointerDown(button, { clientX: 40, clientY: 40 });
    fireEvent.pointerUp(button);
    fireEvent.click(button);

    const battle = combatStore.getState().battle;
    // Either it is waiting for a target or it has already resolved — what
    // matters is that the tap was not swallowed.
    expect(battle?.phase === 'selectTarget' || battle?.hand.length === 4).toBe(true);
  });
});
