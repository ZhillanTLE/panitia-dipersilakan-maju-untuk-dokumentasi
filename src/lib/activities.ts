import bank from '../content/activities.json';
import type { ChildLevel } from '../types';

export interface Activity {
  id: string;
  level: ChildLevel;
  title: string;
  minutes: number;
  materials: string;
  steps: string[];
}

export const ACTIVITIES = bank.activities as Activity[];

export function activitiesFor(level: ChildLevel): Activity[] {
  return ACTIVITIES.filter((a) => a.level === level);
}
