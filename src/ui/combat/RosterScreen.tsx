import { PARTY_SIZE, ROSTER } from '@/game/combat/content';
import { EventBus } from '@/bridge/EventBus';
import { gameStore } from '@/state/store';
import { useGameStore } from '@/state/useGameStore';
import { getCombatActions } from '@/state/useCombatStore';
import { StatusIcon } from './StatusIcon';
import type { StatusKind } from '@/game/combat/types';

/** What each character's kit revolves around, for the roster card. */
const TRAITS: Record<string, { label: string; kind: StatusKind | null }> = {
  ivy: { label: 'Poison', kind: 'poison' },
  saber: { label: 'Bleed', kind: 'bleed' },
  cask: { label: 'Stamina drain', kind: null },
  lyra: { label: 'Fatigue', kind: 'fatigue' },
  bruno: { label: 'Raw damage', kind: null },
  hollis: { label: 'Defence', kind: 'immunity' },
  emrys: { label: 'Chain damage', kind: null },
  vesper: { label: 'Lifesteal', kind: 'undying' },
  thane: { label: 'Shields', kind: 'defenseUp' },
};

/**
 * Pre-battle party select.
 *
 * The deck is built from whoever is equipped, so this is the screen the
 * owner-tagged card design exists for: bench Lyra and her cards leave the draw
 * pile entirely.
 *
 * The choice is written to `gameStore`, which is persisted, so a party survives
 * a force-quit.
 */
export function RosterScreen({ onClose }: { onClose: () => void }) {
  const party = useGameStore((s) => s.party);
  const full = party.length >= PARTY_SIZE;

  const toggle = (id: string) => {
    const { setParty } = gameStore.getState();

    if (party.includes(id)) {
      setParty(party.filter((member) => member !== id));
      return;
    }

    // Silently dropping the oldest pick would be worse than refusing: the
    // player would not know which one they lost.
    if (full) return;
    setParty([...party, id]);
  };

  return (
    <div className="roster">
      <div className="roster__panel">
        <header className="roster__head">
          <h2 className="roster__title">Choose your party</h2>
          <span className="roster__count">
            {party.length} / {PARTY_SIZE}
          </span>
        </header>

        <ul className="roster__list">
          {ROSTER.map((character) => {
            const equipped = party.includes(character.id);
            const trait = TRAITS[character.id];
            const locked = !equipped && full;

            return (
              <li key={character.id}>
                <button
                  type="button"
                  className={`recruit${equipped ? ' recruit--equipped' : ''}${locked ? ' recruit--locked' : ''}`}
                  onClick={() => toggle(character.id)}
                  aria-pressed={equipped}
                >
                  <span className="recruit__top">
                    <span className="recruit__name">{character.name}</span>
                    <span className="recruit__trait">
                      {trait?.kind && (
                        <span className={`status status--${trait.kind} recruit__icon`}>
                          <span className="status__icon">
                            <StatusIcon kind={trait.kind} />
                          </span>
                        </span>
                      )}
                      {trait?.label}
                    </span>
                  </span>

                  <span className="recruit__stats">
                    <span>HP {character.maxHealth}</span>
                    <span>ATK {character.attack}</span>
                    <span>DEF {character.defense}</span>
                    <span>SPD {character.speed}</span>
                    <span>STAM {character.maxStamina}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="roster__actions">
          <button
            type="button"
            className="button"
            disabled={party.length === 0}
            onClick={() => {
              getCombatActions().startBattle();
              EventBus.emit('arena:enter');
              onClose();
            }}
          >
            {party.length < PARTY_SIZE ? `Fight with ${party.length}` : 'Fight'}
          </button>

          <button type="button" className="button button--secondary" onClick={onClose}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
