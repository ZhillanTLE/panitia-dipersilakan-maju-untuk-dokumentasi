# DengarBaca Web Prototype

A browser-based reading-assessment prototype for Indonesian primary-school teachers.
The teacher sits beside a child, the child reads a card aloud, and the app listens, highlights each word as it is spoken, flags likely misreadings, and suggests a TaRL reading level. The teacher confirms every result before anything is saved.

---

## What this repo is

This is the **clickable web prototype**(Sooon To Be Deployed) of the DengarBaca assessment flow. It runs entirely in the browser, no server, no cloud calls, no analytics. All student data stays in the browser's private storage (`IndexedDB` + OPFS).

The Android app and Python research harness described in [`claude.md`](./claude.md) are separate repositories. This prototype shares the same data contracts (field names, word statuses, JSON shapes) so results are portable.

---

## Views

| Route | Bahasa Indonesia name | Purpose |
|---|---|---|
| `/` (default) | **Kelas** | Class roster: add students, see who has been placed, export CSV |
| `#bacaan` | **Bacaan** | Reading session: the child reads, the highlight follows, the teacher marks |
| `#tinjau/:id` | **Tinjau** | Review screen: teacher confirms or edits word statuses before the level is set |

The reading view stays mounted while the teacher checks Kelas or Tinjau, so an in-progress session is never lost by navigating away.

---

## Speech recognition modes

The prototype supports four recognition sources, selectable during a session:

| Source key | What it uses | Notes |
|---|---|---|
| `online` | Browser Web Speech API (cloud) | Requires internet; audio leaves the device |
| `ondevice` | Browser Web Speech API (on-device flag) | Availability depends on OS and browser |
| `manual` | Teacher taps each word as the child reads | Works without a microphone or network |
| `simulated` | Scripted replay from `src/lib/simulate.ts` | Used for demos and testing |

The production target is an **offline CTC acoustic model** loaded from a model pack (see [Model pack](#model-pack) below). When a pack is present it is used automatically; the Web Speech sources are the fallback.

---

## Model pack

The acoustic model is not committed to this repository. A model pack is a versioned folder containing:

```
modelpack/<version>/
  manifest.json     # file list, SHA-256 hashes, audio spec, CTC metadata
  batch.onnx        # int8 CTC model for scoring
  vocab.json        # character vocabulary
  thresholds.json   # similarity and forced-alignment thresholds
```

The app looks for an installed pack in OPFS (`modelpacks/<version>/`) first, then falls back to a pack served next to the app at `./modelpack/<version>/`. Every file is verified against the SHA-256 in the manifest before the model loads. A pack that fails verification is rejected outright.

**Installing a pack during development:** place the pack folder at `public/modelpack/<version>/` and run the dev server. The app will pick it up automatically.

**Installing on a classroom phone:** the teacher opens the model-pack screen and picks the folder she copied by cable or SD card. The app verifies and copies it into private browser storage; the source folder is not kept.

---

## Scoring pipeline

The slow path runs entirely in a Web Worker after the child finishes reading:

1. Normalize and tokenize the recognized transcript.
2. Align heard tokens to card words using a gap-penalty DP with join/split detection.
3. Classify each word: `correct`, `substituted`, `omitted`, `repeated`, `self_corrected`, `uncertain`, or `supplied`.
4. Detect common Indonesian misreadings (b/p, d/t, g/k voicing; `ng`/`ny → n`; `ai/au` simplification; consonant-cluster reduction).
5. Compute fluency: words correct per minute (WCPM) and long pauses (> 2 s).

The scoring engine is deterministic and versioned (`ENGINE_VERSION` in `src/lib/scoring.ts`). Changing any output requires bumping the version.

The live highlight (fast path) uses the same alignment cost table but runs incrementally on each recognized fragment. **It never changes a score**, it is UI only.

---

## TaRL rubric

Levels from easiest to hardest: `pemula → huruf → suku_kata → kata → kalimat → paragraf`.

Assessment starts at the top card (`paragraf`) and steps down after each fail. The highest card a child passes sets their level; failing all the way to `huruf` means `pemula`. The rubric thresholds (minimum accuracy per card) live in `src/content/rubric.json` and are referenced by version in every saved result.

The teacher's confirmation is stored beside the engine suggestion; the original engine output is never overwritten.

---

## Non-negotiable rules

These are product and ethics rules. They must not be weakened without a team decision record.

- **Teacher confirms before anything counts.** Suggestions are `pending_teacher` until confirmed.
- **No diagnosis.** The words *disleksia*, *diagnosis*, *gangguan*, *risiko* never appear in child-facing or report copy.
- **No ranking.** Children are never sorted or compared by score. Groups are by confirmed level only.
- **The highlight never changes a score.** Live tracker events are UI and telemetry only.
- **Same ending for every child.** "Terima kasih!" after a test, whatever the result.
- **No internet required.** The app has no external calls. Exports leave the device only when the teacher acts.
- **Students are stored as codes** (`K2-03`). The display name the teacher types on this device is never exported.

---

## Privacy

- All data is stored in the browser's private storage (IndexedDB and OPFS). Nothing is sent to a server.
- Audio clips are deleted after the teacher confirms a session unless the `audio_research` consent flag is set.
- Three separate consent flags per student: `assessment`, `audio_research`, `camera_mode_b`. A student with no consent can still be assessed manually.
- The CSV export contains student code, confirmed level, and date only no scores, no names.

---

## Project structure

```
src/
  components/       Reusable UI: AudioBar, Book, Ladder, ListenButton,
                    Navbar, ReadingText, Toast, Trail, WordMenu
  content/          Static data: activities.json, cards.json, rubric.json
  lib/
    asr/            Acoustic model layer
      ctc.ts          CTC greedy decode and Viterbi forced alignment
      ctc.worker.ts   Web Worker that runs the ONNX model
      engine.ts       Main-thread handle on the worker; React hook
      pack.ts         Pack discovery, hash verification, OPFS install
    activities.ts   Activity bank helpers
    audio.ts        Microphone capture (16 kHz mono PCM)
    cards.ts        Card bank helpers and word tokenization
    db.ts           IndexedDB wrapper (students, sessions, takes, audio)
    demo.ts         Example data seeded for the prototype
    format.ts       Number and time formatting (Indonesian locale)
    pcm-worklet.js  AudioWorklet: per-frame RMS and zero-crossing rate
    prefs.ts        Persistent teacher preferences
    progress.ts     Class progress: new / pending / placed per student
    route.ts        Hash-based router
    rubric.ts       TaRL rubric: card outcome, level suggestion, order
    scoring.ts      Word alignment, substitution check, fluency, WCPM
    simulate.ts     Scripted session replay for demos
    speech.ts       Web Speech API wrapper and manual-tap stream
    store.ts        In-memory app state; React hooks; IndexedDB sync
    syllables.ts    Syllable nucleus detector and per-frame features
  styles/
    base.css        Reset and layout
    tokens.css      Design tokens (colours, spacing, type scale)
  views/
    ClassView.tsx   Roster, progress summary, CSV export
    ReadView.tsx    Reading session: highlight, scoring, teacher marks
    ReviewView.tsx  Post-session review: word-by-word confirm / edit
  App.tsx           Root: routing, navbar, persistent-storage banner
  main.tsx          Entry point
  strings.ts        All user-facing strings (Bahasa Indonesia)
  types.ts          Shared TypeScript types (mirrors the JSON contract)
planner/            Python stub for the online planning pipeline (separate spec)
public/
  favicon.svg
  manifest.webmanifest
```

---

## Getting started

**Requirements:** Node.js 20+ and npm.

```bash
# Install dependencies
npm install

# Start the development server (http://localhost:5173)
npm run dev

# Type-check
npm run typecheck

# Run unit tests (scoring engine, CTC, rubric, syllables)
npm test

# Production build
npm run build
```

There are no environment variables required to run the prototype. The model pack is optional; without it the app falls back to Web Speech or manual mode.

---

## Tests

Unit tests cover the deterministic parts of the pipeline:

| File | What it tests |
|---|---|
| `src/lib/scoring.test.ts` | Word alignment, substitution detection, fluency, edge cases |
| `src/lib/rubric.test.ts` | Card outcomes, level suggestion, step-down logic |
| `src/lib/asr/ctc.test.ts` | Greedy decode, Viterbi forced alignment |
| `src/lib/syllables.test.ts` | Nucleus detector, syllable count |

Run with `npm test` (Vitest). Tests never make network calls.

---

## Content

- **Cards** (`src/content/cards.json`): reading cards at each level (`huruf`, `suku_kata`, `kata`, `kalimat`, `paragraf`), with layout (`prose`, `lines`, `grid`), word blocks, optional syllable splits, and trail stops.
- **Rubric** (`src/content/rubric.json`): minimum accuracy thresholds per card level, error statuses, start card, and the assessment step-down order.
- **Activities** (`src/content/activities.json`): suggested post-placement activities per level, referenced by the online planner.

Card and rubric content is draft. It needs educator sign-off before a real pilot.

---

## Online planner

`dengarbaca-online-planner.md` describes a planned multi-agent pipeline that runs on a web console when the teacher syncs. It converts confirmed levels and practice summaries into an N-week teaching calendar, fits it into the class timetable, and closes the loop with a re-assessment. That pipeline is a separate build on top of this prototype and is not included here.

---

## Key constraints to keep in mind

- The scoring engine must produce byte-identical output for the same inputs across builds. Bump `ENGINE_VERSION` in `src/lib/scoring.ts` whenever any output changes.
- The rubric version is embedded in every saved result. Changing `rubric.json` requires bumping its `version` field.
- No model constant, threshold, or rubric value is hard-coded outside the content files.
- Every scenario must pass with no network access.
- Demo data (`demo: true`) is labelled "contoh" everywhere it appears and is never exported.
