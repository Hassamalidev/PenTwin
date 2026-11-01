import type { StyleFeatures } from '@pentwin/shared';

/**
 * What the app has learned about one writer. Kept in this browser only: it is never sent
 * anywhere except as ordinary render settings, and holds no handwriting and no text.
 */
export interface HandMemory {
  /** Measured from the writer's own sample page. */
  style?: StyleFeatures;
  /** Multiplier on how uneven the writing is, learned from the writer's answers. */
  scale: number;
  /** How many answers it has learned from. */
  answers: number;
}

export type HandAnswer = 'too-neat' | 'right' | 'too-messy';

const KEY = 'pentwin.hand.v1';
const MIN_SCALE = 0.5;
const MAX_SCALE = 1.8;
/** Size of the first step. Later answers move it less, so it settles instead of swinging. */
const FIRST_STEP = 0.2;

export const NEW_HAND: HandMemory = { scale: 1, answers: 0 };

/** Learns from one answer. "Looks right" moves nothing, but makes later steps smaller. */
export function learnFromAnswer(memory: HandMemory, answer: HandAnswer): HandMemory {
  const step = FIRST_STEP / Math.sqrt(memory.answers + 1);
  const direction = answer === 'too-neat' ? 1 : answer === 'too-messy' ? -1 : 0;
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, memory.scale * Math.exp(direction * step)));
  return { ...memory, scale: Math.round(scale * 1000) / 1000, answers: memory.answers + 1 };
}

export function loadHand(): HandMemory {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return { ...NEW_HAND, ...(JSON.parse(saved) as Partial<HandMemory>) };
  } catch {
    // Storage off or damaged: start fresh. Nothing depends on it.
  }
  return NEW_HAND;
}

export function saveHand(memory: HandMemory): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // Storage full or switched off: it simply will not be remembered.
  }
}

export function forgetHand(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do.
  }
}
