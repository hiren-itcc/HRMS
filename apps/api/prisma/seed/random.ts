/**
 * Varied, but not unrepeatable.
 *
 * Every name, phone number, salary and attendance quirk in the demo workspace
 * comes from here, and all of it is driven by one fixed seed. Two runs produce
 * an identical database — which is the whole point. `Math.random()` would make
 * "is this a bug, or just how this run came out?" unanswerable, and the seed
 * has already made that call once, for the attendance sprinkle.
 *
 * mulberry32: thirty-odd characters of arithmetic instead of a dependency.
 */

const SEED = 20_260_806;

export interface Random {
  /** Inclusive both ends. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** True with the given probability. */
  chance(probability: number): boolean;
  /** A new array, shuffled; the input is untouched. */
  shuffle<T>(items: readonly T[]): T[];
  /** Rounded to the nearest `step` — salaries that end in 000, not in 417. */
  step(min: number, max: number, step: number): number;
}

export function makeRandom(seed: number = SEED): Random {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };

  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));

  return {
    int,
    pick: <T>(items: readonly T[]) => items[int(0, items.length - 1)] as T,
    chance: (probability: number) => next() < probability,
    shuffle<T>(items: readonly T[]) {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = int(0, i);
        [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
      }
      return copy;
    },
    step: (min, max, step) => Math.round(int(min, max) / step) * step,
  };
}

// ── Pools ────────────────────────────────────────────────────────────────
// Twenty lines of arrays rather than a faker dependency: this is the entire
// requirement, and a package for it is supply-chain risk bought with nothing.

export const FIRST_NAMES_F = [
  'Aditi',
  'Ananya',
  'Divya',
  'Fatima',
  'Ishita',
  'Kavya',
  'Lakshmi',
  'Meghna',
  'Neha',
  'Pooja',
  'Rhea',
  'Sanya',
  'Shreya',
  'Tanvi',
  'Vaishnavi',
] as const;

export const FIRST_NAMES_M = [
  'Aditya',
  'Arjun',
  'Devansh',
  'Farhan',
  'Harsh',
  'Karan',
  'Manav',
  'Nikhil',
  'Pranav',
  'Rahul',
  'Sameer',
  'Siddharth',
  'Tarun',
  'Varun',
  'Yash',
] as const;

export const LAST_NAMES = [
  'Agarwal',
  'Bhatt',
  'Chauhan',
  'Deshmukh',
  'Gupta',
  'Joshi',
  'Kulkarni',
  'Malhotra',
  'Menon',
  'Patel',
  'Pillai',
  'Reddy',
  'Sharma',
  'Singh',
  'Trivedi',
] as const;

export const STREETS = [
  'Satellite Road',
  'Bodakdev Lane',
  'Prahladnagar Garden',
  'Navrangpura Cross Road',
  'Baner Road',
  'Kalyani Nagar',
  'Koregaon Park',
  'Indiranagar 100ft Road',
  'Whitefield Main Road',
  'HSR Layout Sector 2',
] as const;

export const BANKS = [
  { bankName: 'HDFC Bank', ifscCode: 'HDFC0001234' },
  { bankName: 'ICICI Bank', ifscCode: 'ICIC0000024' },
  { bankName: 'Axis Bank', ifscCode: 'UTIB0000123' },
  { bankName: 'State Bank of India', ifscCode: 'SBIN0001122' },
  { bankName: 'Kotak Mahindra Bank', ifscCode: 'KKBK0000456' },
  { bankName: 'Yes Bank', ifscCode: 'YESB0000011' },
] as const;

export const RELATIONS = ['Spouse', 'Father', 'Mother', 'Brother', 'Sister'] as const;
