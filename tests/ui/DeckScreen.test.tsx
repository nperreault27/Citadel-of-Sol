import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeckScreen } from '@/ui/combat/DeckScreen';
import { gameStore } from '@/state/store';
import { CARD_DEFS, defaultDeck } from '@/game/combat/content';
import { MIN_DECK_SIZE, deckSize } from '@/game/combat/deckbuilding';
import { KEYWORDS } from '@/ui/combat/keywords';

const PARTY = ['ivy', 'saber', 'cask'];

const initial = gameStore.getState();

beforeEach(() => {
  gameStore.setState(initial, true);
  gameStore.getState().setParty([...PARTY]);
  gameStore.getState().setDeck({});
});

/** The stepper row for a named card. */
function rowFor(container: HTMLElement, cardName: string): HTMLElement {
  const heading = within(container).getByText(cardName);
  const row = heading.closest('.deck-row');
  if (!row) throw new Error('no row for ' + cardName);
  return row as HTMLElement;
}

function plusIn(row: HTMLElement): HTMLButtonElement {
  return within(row).getByRole('button', { name: /^Add a copy/ }) as HTMLButtonElement;
}

/**
 * Whether the card refuses another copy.
 *
 * It carries `aria-disabled`, not `disabled`: a capped card still has to feel
 * a press-and-hold so its rules text can be read, and a disabled button never
 * sees one.
 */
function isCapped(button: HTMLButtonElement): boolean {
  return button.getAttribute('aria-disabled') === 'true';
}

/** The count badge, which doubles as the remove button. Absent at zero. */
function minusIn(row: HTMLElement): HTMLButtonElement {
  return within(row).getByRole('button', { name: /^Remove a copy/ }) as HTMLButtonElement;
}

describe('DeckScreen', () => {
  it('starts every character empty, with no count badge', () => {
    const { container } = render(<DeckScreen onBack={() => {}} />);

    expect(deckSize(gameStore.getState().deck)).toBe(0);
    // A zero on every card would be noise; the outline carries "included".
    expect(rowFor(container, 'Inject').querySelector('.deck-row__count')).toBeNull();
  });

  it('tags every section and card with its owner, which is what colours them', () => {
    const { container } = render(<DeckScreen onBack={() => {}} />);

    // Inject is Ivy's basic, so both her shelf and her card answer to her.
    expect(container.querySelector('.deck__section[data-owner="ivy"]')).not.toBeNull();
    expect(rowFor(container, 'Inject').querySelector('.card')?.getAttribute('data-owner')).toBe(
      'ivy'
    );

    // Cards nobody owns still answer to something, or they would fall back to
    // whatever the last rule left in the cascade.
    expect(container.querySelector('.deck__section[data-owner="team"]')).not.toBeNull();
  });

  it('says what a card is for, and gives the full rules to a hold', async () => {
    const { container } = render(<DeckScreen onBack={() => {}} />);

    // The card carries the short version; the exact wording is Inject's brief.
    expect(
      within(rowFor(container, 'Inject')).getByText('Damage and 1 Poison')
    ).toBeInTheDocument();
    expect(screen.queryByText('Deal damage and apply 1 Poison.')).toBeNull();

    const card = plusIn(rowFor(container, 'Inject'));
    fireEvent.pointerDown(card, { clientX: 10, clientY: 10 });
    await waitFor(() =>
      expect(screen.getByText('Deal damage and apply 1 Poison.')).toBeInTheDocument()
    );

    // Still there once the thumb is off it; the next tap is what closes it.
    fireEvent.pointerUp(card);
    expect(screen.getByText('Deal damage and apply 1 Poison.')).toBeInTheDocument();

    fireEvent.pointerDown(container.querySelector('.card-detail') as HTMLElement);
    expect(screen.queryByText('Deal damage and apply 1 Poison.')).toBeNull();
  });

  it('puts Power on a held card that hits, and nothing on one that does not', async () => {
    const { container } = render(<DeckScreen onBack={() => {}} />);

    // Inject deals damage, so it has a Power. The number itself is balance and
    // is expected to move, so only its shape is asserted.
    const inject = plusIn(rowFor(container, 'Inject'));
    fireEvent.pointerDown(inject, { clientX: 10, clientY: 10 });
    await waitFor(() => expect(screen.getByText(/^Power \d+$/)).toBeInTheDocument());
    fireEvent.pointerUp(inject);

    // Regroup only draws cards. A Power of zero would be a lie about it.
    const regroup = plusIn(rowFor(container, 'Regroup'));
    fireEvent.pointerDown(regroup, { clientX: 10, clientY: 10 });
    await waitFor(() => expect(screen.getByText('Draw 2 cards.')).toBeInTheDocument());
    expect(screen.queryByText(/^Power/)).toBeNull();
    fireEvent.pointerUp(regroup);
  });

  it('explains the keywords a held card uses', async () => {
    const { container } = render(<DeckScreen onBack={() => {}} />);

    // Sever applies Bleed and says so, but the card has no room to say what
    // Bleed is — the hold does.
    // Asserted against the glossary itself, not a copy of its wording: the
    // numbers in it come from the tuning constants and are meant to move.
    const sever = plusIn(rowFor(container, 'Sever'));
    fireEvent.pointerDown(sever, { clientX: 10, clientY: 10 });
    await waitFor(() => expect(screen.getByText(KEYWORDS.bleed.text)).toBeInTheDocument());
    const glossary = container.querySelector('.keywords') as HTMLElement;
    expect(within(glossary).getByText('Bleed')).toBeInTheDocument();
    fireEvent.pointerDown(container.querySelector('.card-detail') as HTMLElement);

    // Buckshot deals damage and drains stamina. Stamina is a bar, not a
    // keyword, so there is nothing here to explain.
    const buckshot = plusIn(rowFor(container, 'Buckshot'));
    fireEvent.pointerDown(buckshot, { clientX: 10, clientY: 10 });
    await waitFor(() =>
      expect(screen.getByText('Deal damage and drain 40 stamina.')).toBeInTheDocument()
    );
    expect(container.querySelector('.keywords')).toBeNull();
  });

  it('does not add a copy of the card the player was only reading', async () => {
    const { container } = render(<DeckScreen onBack={() => {}} />);

    const card = plusIn(rowFor(container, 'Inject'));
    fireEvent.pointerDown(card, { clientX: 10, clientY: 10 });
    await waitFor(() => expect(screen.getByText(/Deal damage and apply/)).toBeInTheDocument());
    fireEvent.pointerUp(card);
    fireEvent.click(card);

    expect(gameStore.getState().deck['ivy.inject']).toBeUndefined();
  });

  it('shows the copy count on the card once it is added', async () => {
    const user = userEvent.setup();
    const { container } = render(<DeckScreen onBack={() => {}} />);

    const row = rowFor(container, 'Inject');
    await user.click(plusIn(row));
    await user.click(plusIn(rowFor(container, 'Inject')));

    const badge = rowFor(container, 'Inject').querySelector('.deck-row__count');
    expect(badge?.textContent).toBe('2');
  });

  it('outlines a card that is in the deck', async () => {
    const user = userEvent.setup();
    const { container } = render(<DeckScreen onBack={() => {}} />);

    expect(rowFor(container, 'Inject').className).not.toContain('deck-row--in');

    await user.click(plusIn(rowFor(container, 'Inject')));
    expect(rowFor(container, 'Inject').className).toContain('deck-row--in');
  });

  it('drops the badge again when the last copy is removed', async () => {
    const user = userEvent.setup();
    const { container } = render(<DeckScreen onBack={() => {}} />);

    await user.click(plusIn(rowFor(container, 'Inject')));
    await user.click(minusIn(rowFor(container, 'Inject')));

    expect(rowFor(container, 'Inject').querySelector('.deck-row__count')).toBeNull();
    expect(rowFor(container, 'Inject').className).not.toContain('deck-row--in');
  });

  it('adds a copy when plus is tapped', async () => {
    const user = userEvent.setup();
    const { container } = render(<DeckScreen onBack={() => {}} />);

    await user.click(plusIn(rowFor(container, 'Inject')));

    expect(gameStore.getState().deck['ivy.inject']).toBe(1);
  });

  it('stops a basic at four copies', async () => {
    const user = userEvent.setup();
    const { container } = render(<DeckScreen onBack={() => {}} />);

    const row = rowFor(container, 'Inject');
    for (let i = 0; i < 4; i++) await user.click(plusIn(row));

    expect(gameStore.getState().deck['ivy.inject']).toBe(4);
    expect(isCapped(plusIn(rowFor(container, 'Inject')))).toBe(true);

    // Capped means capped, attribute or not.
    await user.click(plusIn(rowFor(container, 'Inject')));
    expect(gameStore.getState().deck['ivy.inject']).toBe(4);
  });

  it('stops a unique at one copy and marks it maxed', async () => {
    const user = userEvent.setup();
    const { container } = render(<DeckScreen onBack={() => {}} />);

    await user.click(plusIn(rowFor(container, 'Cascade')));

    const row = rowFor(container, 'Cascade');
    expect(isCapped(plusIn(row))).toBe(true);
    // A dead card has to say so on the card itself — there is no tooltip on a
    // phone.
    expect(within(row).getByText('MAX')).toBeInTheDocument();
  });

  it('offers no remove control until a card is in the deck', () => {
    const { container } = render(<DeckScreen onBack={() => {}} />);

    // The count badge is the remove button, so at zero there is nothing to tap.
    expect(
      within(rowFor(container, 'Inject')).queryByRole('button', { name: /^Remove a copy/ })
    ).toBeNull();
  });

  it('distinguishes a budget block from a copy limit', async () => {
    // Only Hollis can be budget-blocked while a card is still under its own cap.
    // For a three-card character 4 + 2 + 1 is exactly the budget, so reaching 7
    // means every card is simultaneously maxed. His four cards allow nine.
    gameStore.getState().setParty(['hollis']);
    gameStore.getState().setDeck({});

    const user = userEvent.setup();
    const { container } = render(<DeckScreen onBack={() => {}} />);

    for (let i = 0; i < 4; i++) await user.click(plusIn(rowFor(container, 'Strike')));
    for (let i = 0; i < 2; i++) await user.click(plusIn(rowFor(container, 'Goad')));
    await user.click(plusIn(rowFor(container, 'Ironclad')));

    expect(screen.getByText('7 / 7')).toBeInTheDocument();

    // Strike is at its own limit of 4, so it says MAX.
    expect(within(rowFor(container, 'Strike')).getByText('MAX')).toBeInTheDocument();

    // Rebound has none of its two copies used — only the budget is stopping it,
    // so the header explains it rather than the card claiming to be maxed.
    const rebound = rowFor(container, 'Rebound');
    expect(isCapped(plusIn(rebound))).toBe(true);
    expect(within(rebound).queryByText('MAX')).toBeNull();
  });

  it('blocks Fight below the deck floor, and says the size', () => {
    gameStore.getState().setDeck({ 'ivy.inject': 4 });
    render(<DeckScreen onBack={() => {}} />);

    expect(screen.getByRole('button', { name: 'Fight' })).toBeDisabled();
    expect(screen.getByText(/4 cards, needs at least 20/i)).toBeInTheDocument();
  });

  it('allows Fight once the deck is legal', () => {
    gameStore.getState().setDeck(defaultDeck(PARTY));
    render(<DeckScreen onBack={() => {}} />);

    expect(deckSize(gameStore.getState().deck)).toBeGreaterThanOrEqual(MIN_DECK_SIZE);
    expect(screen.getByRole('button', { name: 'Fight' })).toBeEnabled();
  });

  it('shows the running deck size against the floor', () => {
    gameStore.getState().setDeck({ 'ivy.inject': 4, 'team.regroup': 3 });
    render(<DeckScreen onBack={() => {}} />);

    expect(screen.getByText(`7 / ${MIN_DECK_SIZE}`)).toBeInTheDocument();
  });

  it('enforces the seven-card budget per character', async () => {
    const user = userEvent.setup();
    const { container } = render(<DeckScreen onBack={() => {}} />);

    // Ivy's three cards allow exactly 4 + 2 + 1 = 7.
    for (const [name, copies] of [
      ['Inject', 4],
      ['Disperse', 2],
      ['Cascade', 1],
    ] as const) {
      const row = rowFor(container, name);
      for (let i = 0; i < copies; i++) await user.click(plusIn(row));
    }

    expect(screen.getByText('7 / 7')).toBeInTheDocument();
    // And every one of her cards is now capped.
    expect(isCapped(plusIn(rowFor(container, 'Inject')))).toBe(true);
  });

  it('only offers cards from the equipped party', () => {
    const { container } = render(<DeckScreen onBack={() => {}} />);

    // Bruno is not in the party, so Haymaker is not on offer.
    expect(within(container).queryByText('Haymaker')).toBeNull();
    expect(within(container).getByText('Inject')).toBeInTheDocument();
  });

  it('drops a benched character cards from the deck', () => {
    gameStore.getState().setDeck(defaultDeck(PARTY));
    expect(gameStore.getState().deck['ivy.inject']).toBeGreaterThan(0);

    // Benching Ivy has to clear her cards, not leave an invalid deck behind.
    gameStore.getState().setParty(['saber', 'cask']);

    expect(gameStore.getState().deck['ivy.inject']).toBeUndefined();
    expect(gameStore.getState().deck['saber.sever']).toBeGreaterThan(0);
  });

  it('always offers the neutral cards', () => {
    const { container } = render(<DeckScreen onBack={() => {}} />);

    expect(within(container).getByText('Regroup')).toBeInTheDocument();
    expect(within(container).getByText('Team cards')).toBeInTheDocument();
  });

  it('lets a mostly-neutral deck be legal', async () => {
    // 16 neutrals plus 4 character cards is exactly 20 — a deck the rules
    // deliberately permit.
    const neutrals = Object.values(CARD_DEFS).filter((card) => card.ownerId === null);
    const deck: Record<string, number> = {};
    for (const card of neutrals) deck[card.id] = 4;
    deck['ivy.inject'] = 4;

    gameStore.getState().setDeck(deck);
    render(<DeckScreen onBack={() => {}} />);

    expect(deckSize(gameStore.getState().deck)).toBe(20);
    expect(screen.getByRole('button', { name: 'Fight' })).toBeEnabled();
  });
});
