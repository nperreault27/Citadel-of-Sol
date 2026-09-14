/**
 * Each character's primary role, as written in their doc comment in
 * `content.ts`. Roles are not in the game data, so keep this table in step.
 */

export type Role = 'DPS' | 'SUP' | 'SUS';

export const ROLE: Record<string, Role> = {
  ivy: 'DPS',
  saber: 'SUP',
  cask: 'SUP',
  lyra: 'SUP',
  bruno: 'DPS',
  hollis: 'SUS',
  emrys: 'DPS',
  vesper: 'DPS',
  thane: 'SUS',
  ignis: 'DPS',
  marlo: 'SUP',
};

export const ROLES: Role[] = ['DPS', 'SUP', 'SUS'];

/** A party's roles as one sorted key, e.g. "DPS+DPS+SUP". */
export function composition(party: readonly string[]): string {
  return party
    .map((id) => ROLE[id] ?? '?')
    .sort()
    .join('+');
}

export function roleCount(party: readonly string[], role: Role): number {
  return party.filter((id) => ROLE[id] === role).length;
}
