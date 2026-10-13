import { CAR_PACK } from './car.js';
import { COMPANY_PACK } from './company.js';
import { packGuide } from './guide.js';
import { MONEY_PACK } from './money.js';
import { MUSIC_PACK } from './music.js';
import type { Pack } from './pack.js';
import { STUDY_PACK } from './study.js';

export * from './pack.js';
export * from './fact-check.js';
export * from './cases.js';
export { CAR_PACK } from './car.js';
export { MONEY_PACK } from './money.js';
export { MUSIC_PACK } from './music.js';
export { STUDY_PACK } from './study.js';
export { COMPANY_PACK } from './company.js';
export { packGuide } from './guide.js';

/** Packs a project can start from (R8, R9). */
export const PACKS: readonly Pack[] = [CAR_PACK, MONEY_PACK, MUSIC_PACK, STUDY_PACK, COMPANY_PACK];

/** The agent-facing guide to setting up any pack project (R9.6 prep). */
export const PACK_GUIDE = packGuide(PACKS);

export function findPack(key: string): Pack | undefined {
  return PACKS.find((p) => p.key === key);
}
