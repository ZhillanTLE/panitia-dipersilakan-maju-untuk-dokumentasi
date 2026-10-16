import bank from '../content/activities.json';
import type { PatternId } from './patterns';
import type { ChildLevel } from '../types';

export interface Activity {
  id: string;
  level: ChildLevel;
  title: string;
  minutes: number;
  /** Error patterns this activity practises; empty means general practice. */
  patterns: PatternId[];
  materials: string;
  steps: string[];
}

export const ACTIVITIES = bank.activities as Activity[];

export function activitiesFor(level: ChildLevel): Activity[] {
  return ACTIVITIES.filter((a) => a.level === level);
}
