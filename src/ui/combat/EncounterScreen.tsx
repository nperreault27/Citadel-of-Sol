import { useState } from 'react';
import {
  ENEMY_TEAMS,
  enemyTiers,
  teamsOfTier,
  type EnemyTeam,
} from '@/game/combat/content';
import { gameStore } from '@/state/store';
import { useGameStore } from '@/state/useGameStore';
import type { Combatant } from '@/game/combat/types';
import { EnemySheet } from './EnemySheet';

/** What each tier is, in a word. Indexed by tier number. */
const TIER_NAMES: Record<number, string> = {
  1: 'The Proving Ground',
  2: 'The Deep Ward',
  3: 'Capstone',
};

/**
 * Pick a fight, before picking who fights it.
 *
 * This comes first in the pre-battle flow on purpose. The party screen asks the
 * player to choose three of nine and the deck builder asks them to spend a card
 * budget, and neither question has a right answer until you know what you are
 * walking into — a party that flattens the Ratkin Pack is the wrong party for
 * the Bulwark. Choosing the opposition first is what makes the two screens
 * after it decisions rather than guesses.
 *
 * Every team is open from the start. There is no progression gating yet, and
 * pretending otherwise by greying out the later tiers would be inventing a rule
 * the game does not have.
 */
export function EncounterScreen({
  onPick,
  onClose,
}: {
  onPick: () => void;
  onClose: () => void;
}) {
  const chosen = useGameStore((s) => s.encounter);

  // The enemy whose moves are open, if any. Scouting is the whole reason the
  // roster below each team is tappable.
  const [scouting, setScouting] = useState<Combatant | null>(null);

  const select = (team: EnemyTeam) => {
    gameStore.getState().setEncounter(team.id);
    onPick();
  };

  return (
    <div className="encounter">
      <div className="encounter__panel">
        <header className="encounter__head">
          <h2 className="encounter__title">Choose your fight</h2>
          <span className="encounter__count">{ENEMY_TEAMS.length} available</span>
        </header>

        <div className="encounter__scroll">
          {enemyTiers().map((tier) => (
            <section key={tier} className="encounter__tier">
              <h3 className="encounter__tier-head">
                <span>{TIER_NAMES[tier] ?? `Tier ${tier}`}</span>
                <span className="encounter__tier-num">Tier {tier}</span>
              </h3>

              <ul className="encounter__list">
                {teamsOfTier(tier).map((team) => (
                  <li key={team.id}>
                    <TeamRow
                      team={team}
                      selected={team.id === chosen}
                      onSelect={() => select(team)}
                      onScout={setScouting}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="encounter__actions">
          <button type="button" className="button button--secondary" onClick={onClose}>
            Back
          </button>
        </div>
      </div>

      <EnemySheet combatant={scouting} onDismiss={() => setScouting(null)} />
    </div>
  );
}

/**
 * One fight: what it is called, what it asks, and who is in it.
 *
 * The enemies are listed rather than merely counted because the line-up *is*
 * the information — "four Ratkin" and "a Bulwark and an Acolyte" are different
 * problems, and the player can only tell by seeing them. Each one opens its
 * move sheet, so the whole fight can be read before a single card is chosen.
 *
 * Those chips sit inside the row's button and stop their own clicks, the same
 * arrangement the status badges use on a combatant panel: a button nested in a
 * button is invalid and swallows the inner click.
 */
function TeamRow({
  team,
  selected,
  onSelect,
  onScout,
}: {
  team: EnemyTeam;
  selected: boolean;
  onSelect: () => void;
  onScout: (combatant: Combatant) => void;
}) {
  const health = team.members.reduce((sum, member) => sum + member.maxHealth, 0);

  return (
    <button
      type="button"
      className={`bout${selected ? ' bout--selected' : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="bout__top">
        <span className="bout__name">{team.name}</span>
        <span className="bout__health">{health} HP</span>
      </span>

      <span className="bout__pitch">{team.pitch}</span>

      <span className="bout__foes">
        {team.members.map((member) => (
          <span
            key={member.id}
            className="bout__foe"
            role="button"
            tabIndex={-1}
            title={`${member.name} — tap to see its moves`}
            onClick={(event) => {
              // Reading the line-up is not choosing the fight.
              event.stopPropagation();
              onScout(member);
            }}
          >
            {member.name}
          </span>
        ))}
      </span>
    </button>
  );
}
