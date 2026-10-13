import { CAR_PACK } from './car.js';
import { MONEY_PACK } from './money.js';
import type { Pack } from './pack.js';

export * from './pack.js';
export * from './fact-check.js';
export * from './cases.js';
export { CAR_PACK } from './car.js';
export { MONEY_PACK } from './money.js';

/** Packs a project can start from (R8). */
export const PACKS: readonly Pack[] = [CAR_PACK, MONEY_PACK];

export function findPack(key: string): Pack | undefined {
  return PACKS.find((p) => p.key === key);
}
