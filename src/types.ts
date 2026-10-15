// Mirrors the result contract in CLAUDE.md ("Contracts"). Field names stay in
// snake_case so stored records match the JSON Schemas the Android app will use.

export type CardLevel = 'huruf' | 'suku_kata' | 'kata' | 'kalimat' | 'paragraf';
export type ChildLevel = 'pemula' | CardLevel;

export type WordStatus =
  | 'correct'
  | 'substituted'
  | 'omitted'
  | 'repeated'
  | 'self_corrected'
  | 'uncertain'
  | 'supplied';

export type Confidence = 'high' | 'medium' | 'low';

/** Where the words came from: on-device recognition, the teacher's own marks, or a scripted simulation. */
export type Source = 'ondevice' | 'manual' | 'simulated';

export interface Card {
  id: string;
  version: number;
  level: CardLevel;
  title: string;
  layout: 'prose' | 'lines' | 'grid';
  blocks: string[];
  /** Syllable split per word, for cards that highlight by syllable ("ma-kan"). */
  syllables?: Record<string, string>;
}

export interface CardWord {
  i: number;
  text: string;
  norm: string;
  block: number;
  sentence: number;
}

export interface WordResult {
  i: number;
  expected: string;
  status: WordStatus;
  heard?: string;
  start_ms?: number;
  confidence?: Confidence;
}

export interface Insertion {
  after_i: number;
  heard: string;
  start_ms?: number;
}

export type LiveEvent =
  | { t_ms: number; type: 'word_ended'; i: number }
  | { t_ms: number; type: 'went_back'; i: number }
  | { t_ms: number; type: 'stalled'; i: number; ms: number }
  | { t_ms: number; type: 'supplied'; i: number };

export interface Quality {
  status: 'ok' | 'retry_suggested' | 'not_measured';
  speech_ratio?: number;
  clipping_pct?: number;
}

export interface Fluency {
  reading_time_s: number | null;
  words_correct: number;
  wcpm: number | null;
  long_pauses: { before_i: number; ms: number }[];
}

export interface Take {
  take_id: string;
  session_id: string;
  student_ref: string;
  card: { id: string; version: number; level: CardLevel };
  source: Source;
  simulated: boolean;
  created_at: number;
  quality: Quality;
  /** Engine output. Never overwritten: teacher changes live in `teacher.edits`. */
  words: WordResult[];
  insertions: Insertion[];
  fluency: Fluency;
  /** Live tracker events. UI and telemetry only; they never change a score. */
  events: LiveEvent[];
  versions: { card: number; model: string; engine: string; rubric: string };
  audio: { stored: boolean; duration_ms?: number; deleted_at?: number };
  teacher: { edits: Record<number, WordStatus>; reviewed_at?: number };
}

/** The engine's level suggestion. Confirmation is stored beside it; the original is never overwritten. */
export interface Suggestion {
  level: ChildLevel | null;
  rule: string;
  status: 'pending_teacher' | 'confirmed';
  confirmed?: { level: ChildLevel | null; rule: string; at: number };
}

export interface Session {
  session_id: string;
  student_ref: string;
  started_at: number;
  ended_at?: number;
  simulated: boolean;
  take_ids: string[];
  suggestion?: Suggestion;
}

export interface Consents {
  assessment: boolean;
  audio_research: boolean;
  camera_mode_b: boolean;
}

export interface Student {
  /** Local pseudonym such as "K2-07". No names, addresses or NIK are stored. */
  student_ref: string;
  created_at: number;
  consents: Consents;
  level?: { value: ChildLevel; confirmed_at: number; session_id: string; rubric: string };
}
