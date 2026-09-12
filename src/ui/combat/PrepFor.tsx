import { enemyTeamById } from '@/game/combat/content';
import { useGameStore } from '@/state/useGameStore';

/**
 * Which fight the screen you are on is preparing for.
 *
 * The encounter is picked first precisely so it can shape the party and the
 * deck, and that only works if it is still in front of the player while they
 * make those choices. Picking the Bulwark and then staring at a roster with no
 * reminder of what it is for puts them back to guessing, which is the thing the
 * ordering was meant to fix.
 *
 * Renders nothing if the id does not resolve — a stale selection should cost a
 * line of context, not the screen.
 */
export function PrepFor() {
  const encounter = useGameStore((s) => s.encounter);
  const team = enemyTeamById(encounter);

  if (!team) return null;

  return (
    <p className="prep-for">
      <span className="prep-for__name">{team.name}</span>
      <span>{team.pitch}</span>
    </p>
  );
}
