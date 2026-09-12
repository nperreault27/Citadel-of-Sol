import { useState } from 'react';
import { EventBus } from '@/bridge/EventBus';
import {
  characterById,
  playerCanAddCopy,
  playerCardPool,
  playerCardsForCharacter,
  playerDeckValidation,
} from '@/game/combat/content';
import { CARDS_PER_CHARACTER, MIN_DECK_SIZE, deckSize } from '@/game/combat/deckbuilding';
import type { AddCheck, DeckList } from '@/game/combat/deckbuilding';
import { gameStore } from '@/state/store';
import { useGameStore } from '@/state/useGameStore';
import { getCombatActions } from '@/state/useCombatStore';
import type { CardDefinition } from '@/game/combat/types';
import { CardDetail, type InspectedCard } from './CardDetail';
import { CardFace, faceClass } from './CardFace';
import { PrepFor } from './PrepFor';
import { useHoldToInspect } from './useHoldToInspect';

/**
 * Deck builder.
 *
 * Every equipped character contributes at most `CARDS_PER_CHARACTER`, copies of
 * a card are capped by its tier, and the whole deck must reach `MIN_DECK_SIZE`.
 * All three rules live in `deckbuilding.ts`; this screen only renders them and
 * reports why a button is disabled rather than going quietly dead.
 *
 * Characters start empty — nothing is chosen for the player — so the `+` control
 * is the most-used thing here and is sized accordingly.
 *
 * Cards here say only what they are for. Holding one opens its full rules text,
 * the same gesture as in hand, so the player learns a card the same way in both
 * places.
 */
export function DeckScreen({ onBack }: { onBack: () => void }) {
  const party = useGameStore((s) => s.party);
  const deck = useGameStore((s) => s.deck);
  const [inspected, setInspected] = useState<InspectedCard | null>(null);

  const pool = playerCardPool(party);
  const validation = playerDeckValidation(deck, party);
  const size = deckSize(deck);

  const setCount = (cardId: string, next: number) => {
    const updated: DeckList = { ...deck };
    if (next <= 0) delete updated[cardId];
    else updated[cardId] = next;
    gameStore.getState().setDeck(updated);
  };

  // Grouped by owner, in party order, with the neutrals last — the same order
  // `availableCards` returns, so the sections match the pool.
  const sections = [
    ...party.map((id) => ({
      id,
      title: characterById(id)?.name ?? id,
      budget: true,
      cards: pool.filter((card) => card.ownerId === id),
    })),
    {
      id: 'team',
      title: 'Team cards',
      budget: false,
      cards: pool.filter((card) => card.ownerId === null),
    },
  ];

  return (
    <div className="deck">
      <div className="deck__panel">
        <header className="deck__head">
          <h2 className="deck__title">Build your deck</h2>
          <span className={`deck__count${size < MIN_DECK_SIZE ? ' deck__count--short' : ''}`}>
            {size} / {MIN_DECK_SIZE}
          </span>
        </header>

        <PrepFor />

        <div className="deck__scroll">
          {sections.map((section) => {
            const used = section.budget ? playerCardsForCharacter(deck, section.id) : 0;

            return (
              <section key={section.id} className="deck__section" data-owner={section.id}>
                <h3 className="deck__section-head">
                  <span>{section.title}</span>
                  {section.budget && (
                    <span
                      className={`deck__budget${used >= CARDS_PER_CHARACTER ? ' deck__budget--full' : ''}`}
                    >
                      {used} / {CARDS_PER_CHARACTER}
                    </span>
                  )}
                </h3>

                <div className="deck__cards">
                  {section.cards.map((card) => (
                    <DeckRow
                      key={card.id}
                      card={card}
                      count={deck[card.id] ?? 0}
                      addCheck={playerCanAddCopy(deck, party, card.id)}
                      onChange={(next) => setCount(card.id, next)}
                      onInspect={setInspected}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {!validation.ok && (
          <ul className="deck__problems">
            {validation.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}

        <CardDetail card={inspected} onDismiss={() => setInspected(null)} />

        <div className="deck__actions">
          <button
            type="button"
            className="button"
            disabled={!validation.ok}
            onClick={() => {
              getCombatActions().startBattle();
              EventBus.emit('arena:enter');
            }}
          >
            Fight
          </button>

          <button type="button" className="button button--secondary" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  card: CardDefinition;
  count: number;
  addCheck: AddCheck;
  onChange: (next: number) => void;
  onInspect: (card: InspectedCard | null) => void;
}

function DeckRow({ card, count, addCheck, onChange, onInspect }: RowProps) {
  const hold = useHoldToInspect((holding) => {
    onInspect(holding ? { card, blockedReason: addCheck.reason } : null);
  });

  return (
    <div className={`deck-row${count > 0 ? ' deck-row--in' : ''}`}>
      {/*
        The card *is* the add button, and the count badge is the remove button.
        A separate stepper under every card doubled the height of a screen that
        already shows a dozen of them.

        They are siblings rather than nested, because a button inside a button
        is invalid and swallows the inner click — the badge is layered over the
        card corner instead.
      */}
      {/*
        `aria-disabled` rather than `disabled`: a card at its cap is exactly the
        one a player wants to read before deciding what to drop, and a disabled
        button is dead to pointer events — it would not feel the hold.
      */}
      <button
        type="button"
        className={`card card--pick ${faceClass('brief')}`}
        data-owner={card.ownerId ?? 'team'}
        aria-disabled={!addCheck.ok}
        onClick={() => {
          // The player was reading, not adding.
          if (hold.consumeHold()) return;
          if (!addCheck.ok) return;
          onChange(count + 1);
        }}
        onPointerDown={hold.onPointerDown}
        onPointerMove={hold.onPointerMove}
        onPointerUp={hold.onPointerUp}
        onPointerLeave={hold.onPointerLeave}
        onPointerCancel={hold.onPointerCancel}
        onContextMenu={hold.onContextMenu}
        title={addCheck.reason ?? `Add a copy of ${card.name}`}
        aria-label={`Add a copy of ${card.name}`}
      >
        <CardFace card={card} detail="brief" />

        {/* At its own copy limit — a fact about this card, so it goes on the
            card. A spent character budget shows in the section header instead,
            where it applies to all of them at once. */}
        {addCheck.blockedBy === 'copyLimit' && <span className="deck-row__max">MAX</span>}
      </button>

      {count > 0 && (
        <button
          type="button"
          className="deck-row__count"
          onClick={() => onChange(count - 1)}
          aria-label={`Remove a copy of ${card.name}`}
          title={`Remove a copy of ${card.name}`}
        >
          {count}
        </button>
      )}
    </div>
  );
}
