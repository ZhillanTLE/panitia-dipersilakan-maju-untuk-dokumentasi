# BacainYuk

A reading assessment and planning tool for Indonesian primary school teachers.

The teacher sits beside a child, the child reads a card aloud, and the app listens, highlights each word as it is spoken, marks likely misreadings and suggests a TaRL reading level. The teacher confirms every result before anything counts. Once the class has confirmed levels, the online planner turns the children's reading metrics into a teaching plan for the next few weeks and fits it into the class timetable as a calendar.

---

## What this repo is

Two parts that share one data contract:

- **The web app** (`src/`): Vite, React 19 and TypeScript. Kelas, Bacaan and Tinjau run in the browser and keep all student data in the browser's private storage (IndexedDB and OPFS). Rencana is the planner screen.
- **The planner** (`planner/`): a small Flask service, one synchronous request per run. It reads codes, confirmed levels and reading metrics, never audio and never names.

The Android app and the Python research harness are separate. The `harness/` folder holds evaluation tooling and reports for the offline acoustic model.

---

## Views

| Route | Name | Purpose |
|---|---|---|
| `#/kelas` | **Kelas** | Class roster, reading ladder by confirmed level, error-pattern counts per group, CSV export |
| `#/bacaan` | **Bacaan** | Reading session: the child reads, the highlight follows, the teacher marks; oral questions after the paragraf card |
| `#/tinjau/:id` | **Tinjau** | Review: confirm or correct each word, see the child's metrics and patterns, confirm the level |
| `#/rencana` | **Rencana** | Online planner: Sinkron, Proses, Kalender and Laporan siklus |

The navbar shows a corner badge on Tinjau with the number of readings waiting for review. The reading view stays mounted while the teacher checks another view, so a session in progress is never lost.

---

## Speech recognition

| Source | What it uses | Notes |
|---|---|---|
| `online` (default, "Asesmen Suara") | Chrome Web Speech API | Needs internet; audio goes to Google while the child reads |
| `ondevice` | Web Speech API with on-device recognition | Depends on the browser and the installed language pack |
| `manual` | The teacher taps the word being read | Works without a microphone or network |
| `simulated` | Scripted replay from `src/lib/simulate.ts` | For demos and tests; never counts as a result |

An offline CTC acoustic model can be loaded from a model pack (below). That path is built but not yet verified end to end in the browser.

---

## Scoring

After the child finishes a card:

1. Normalize and tokenize what was heard.
2. Align heard words to card words with a gap-penalty DP that also detects joined and split words. The reading ends at the last card word heard clearly; text the child has not reached stays unread, and stray recognizer words become insertions instead of being placed further down the card.
3. Mark each word `correct`, `substituted`, `omitted`, `repeated`, `self_corrected`, `uncertain` or `supplied`.
4. Detect common Indonesian misreadings (b/p, d/t, g/k voicing; `ng` and `ny` to `n`; `ai` and `au` simplification; cluster reduction).
5. Compute fluency and long pauses.

The engine is deterministic and versioned (`ENGINE_VERSION` in `src/lib/scoring.ts`, now `scoring-web@0.3`). Any change to its output means a version bump. The live highlight uses the same cost table and only moves on clearly heard words. It never changes a score.

---

## Reading metrics and error patterns

Every number here is computed by rules from the teacher-reviewed word statuses and timings (`src/lib/metrics.ts`). No model writes or changes any of them.

- **Accuracy**: correct of attempted, per card. Self-corrections count as correct; repeats are not errors.
- **Correct units per minute**: letters, syllables or words, matched to the card. Different units are never compared.
- **Error counts by type**, **long pauses** (over 3 seconds, with the word that followed), **self-corrections**.
- **Comprehension**: 2 or 3 oral questions after each paragraf card, tapped right or wrong by the teacher in Bacaan or Tinjau.
- **Confidence**: a flag, never a score, when uncertain words or poor audio make the numbers less reliable.
- **Error patterns**: misread words sorted by shape with up to three examples each. The five patterns are similar letters swapped, closed syllables, ng/ny and consonant clusters, long words, and affixed words. They describe what was read, never why.

The pattern rules live in `src/content/patterns.json` and are implemented twice, in `src/lib/patterns.ts` and `planner/patterns.py`. `src/lib/patterns.cases.json` holds the cases both must agree on; both test suites run them. A child's patterns come from the card at their confirmed level only.

Tinjau shows these per card, plus the pattern list with tappable examples, comprehension, this child's own earlier results, and "berdasarkan N kata yang sudah dikonfirmasi". Kelas shows pattern counts per group ("2 dari 3 anak: suku kata tertutup"), never a list of children.

---

## Online planner (Rencana)

Five stages in one request (`POST /api/planner/run`), each recorded in a trace with its real duration:

1. **Pemeriksa Data** (code): validates the schema 2.0 payload and computes group facts from the per-child metrics.
2. **Agen Peringkas Bukti** (agent): writes 1 to 3 evidence lines per group.
3. **Agen Penyusun Sesi** (agent): picks activities and passages from the library for N weeks; every practice session has a `focus` pattern.
4. **Pemeriksa Aturan** (code): checks the plan and the evidence. Every number in an evidence line must be one of the group's facts; percentages, child codes, level moves and banned words are stripped. A focus must be a pattern the group actually showed, and the first session must practise the most frequent one. Failed checks go back to the agent for up to two repairs, then a rule-based plan is used and labelled.
5. **Penjadwal** (code): a deterministic solver places sessions in the literacy periods. It respects the number of phones, skips holidays, spreads each group across days and puts re-placement in the final week.

Agents choose what to teach. They never set a time, a level or a metric, never rank, never diagnose. Each session's tip ("Baca suku kata terbuka, lalu tambah satu huruf...") is built by code from the chosen activity and example words from that group's own readings.

**Screens**

- **Sinkron**: the class summary and cycle settings, and a switch to run the agents on Gemini instead of the rule-based stand-ins.
- **Proses**: the pipeline, revealed one stage at a time with a loading state for each. Steps open in order: Proses after a run starts, Kalender when the run is done, Laporan after approval.
- **Kalender**: Monday to Friday over the whole school day. Sessions can be dragged to any free hour; literacy periods are shaded as suggestions. Each card leads with the teacher's tip, and clicking it shows the steps, materials and reading cards. Nothing reaches the phone until the teacher presses Setujui, and the server checks every move again.
- **Laporan siklus**: counts only. Each child is compared with their own start, speeds only within the same unit, and targeted patterns are shown before and after.

**Run modes** (shown as a badge on the page)

| Setting | Effect |
|---|---|
| default | Mock: rule-built evidence and the rule-based plan, no model |
| `MOCK_LLM=true` | Mock, explicitly |
| `PLANNER_LIVE_INFERENCE=1` | Gemini by default for every run; refuses with HTTP 503 when `GEMINI_API_KEY` is missing |
| `PLANNER_FIXTURES=1` | Replays the captured run in `planner/fixtures/K2.golden.json`, fully offline |
| switch in Sinkron | Picks live or mock per run (`?inference=live` or `mock`) |

The key and model go in `planner/.env` (gitignored):

```
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-flash-lite-latest
```

**Endpoints**: `GET /api/planner/health`, `POST /run`, `POST /approve`, `POST /replan`, `POST /report`, `GET /plan/<class>`, `GET /phone/<class>`. The Vite dev and preview servers proxy `/api/planner` to `127.0.0.1:8000`, so the browser stays same-origin.

---

## Getting started

**Requirements:** Node.js 20+, npm, Python 3.11+.

```bash
npm install
pip install -r planner/requirements.txt

# The web app (http://localhost:5173)
npm run dev

# The planner service (http://127.0.0.1:8000), in a second terminal
python -m planner.app

# Checks
npm run typecheck
npm test
python -m unittest planner.tests.test_planner
python scripts/scope_check.py

# Production build
npm run build
```

Kelas, Bacaan and Tinjau work without the planner running. Rencana shows a clear message when the planner cannot be reached.

**Sample data tools**

```bash
python -m planner.tools.build_sample           # writes planner/fixtures/K2.sync.json, a sample class
python -m planner.tools.build_golden --class K2  # captures the replay fixture from it
```

---

## Demo state

On first load a browser is reset once to the demo class "Kelas 2X": fourteen students, thirteen with confirmed example readings that mix right and wrong words, and Bagus (K2-02) left unread to try the reading flow. Example readings are labelled "contoh" everywhere and never exported. Bumping `DEMO_KEY` in `src/lib/store.ts` resets every browser to the demo again.

---

## Tests

| File | What it covers |
|---|---|
| `src/lib/scoring.test.ts` | Alignment, misreadings, fluency, a reading that stops early |
| `src/lib/rubric.test.ts` | Card outcomes, level suggestion, step-down |
| `src/lib/metrics.test.ts` | Metrics, pattern hits, history, group counts, the shared pattern cases |
| `src/lib/asr/ctc.test.ts` | CTC greedy decode and forced alignment |
| `src/lib/syllables.test.ts` | Syllable nucleus detector and counts |
| `planner/tests/test_planner.py` | Validation, the shared pattern cases, evidence number checks, repair and fallback, focus rules, scheduling, approval, re-planning, the report, replay, privacy |

The Python suite neutralises `.env`, so no test can make a billed model call. `scripts/scope_check.py` fails on banned diagnosis or ranking words in planner copy, audio or name fields in the sync schema, agent output fields that overlap the payload, and model or network calls inside the deterministic modules.

---

## Non-negotiable rules

- **The teacher confirms before anything counts.** Suggestions stay `pending_teacher` until she confirms.
- **No diagnosis.** *disleksia*, *diagnosis*, *gangguan* and *risiko* never appear in child-facing, report or planner copy.
- **No ranking.** Children are never sorted or compared by score. Groups come from confirmed levels only.
- **The highlight never changes a score.**
- **The same ending for every child.** "Terima kasih!" after every reading.
- **Agents never decide levels, metrics or times.** Code does, and every number an agent cites is checked against the data.
- **Nothing reaches the phone before the teacher approves.**
- **Students are codes** (`K2-03`). The name the teacher types stays on this device and is never sent or exported.

---

## Privacy

- Kelas, Bacaan and Tinjau store data only in the browser. The default online recognizer sends audio to Google while a child reads; the manual and on-device sources do not.
- Recordings are deleted after the teacher confirms, unless the student has the `audio_research` consent.
- The planner receives codes, confirmed levels and rule-computed metrics. Never audio, names or notes. A kept clip goes only as a `clipId` pointer to the recording on the device.
- With the Gemini switch on, the group facts (counts and example words, no codes) are sent to Google.
- The CSV export holds student code, confirmed level and date only.

---

## Project structure

```
src/
  components/      AudioBar, Book, Ladder, ListenButton, Navbar, Questions,
                   ReadingText, Toast, Trail, WordMenu
  content/         activities.json (with tips and patterns), cards.json (with
                   comprehension questions), patterns.json, rubric.json
  lib/
    asr/           Offline acoustic model: CTC decode, worker, model pack
    metrics.ts     Per-child reading metrics, patterns, history
    patterns.ts    Error pattern rules (shared with planner/patterns.py)
    planner.ts     Planner API client, sync payload, calendar moves
    scoring.ts     Alignment, misreadings, fluency
    store.ts       App state, IndexedDB sync, demo state
    ...            audio, cards, db, demo, format, prefs, progress, route,
                   rubric, simulate, speech, syllables
  views/           ClassView, ReadView, ReviewView, PlannerView
  plannerStrings.ts, strings.ts   All user-facing copy (Bahasa Indonesia)
planner/
  app.py           Flask routes
  pipeline.py      The five stages and their trace
  intake.py        Payload validation and group facts
  agents.py        Evidence Summarizer and Planner
  checker.py       Evidence and plan rules
  scheduler.py     Deterministic timetable solver
  approval.py      Re-checks the teacher's calendar; phone pull
  report.py        End-of-cycle report
  library.py       Activity library, passage packs by pattern, session tips
  patterns.py      Error pattern rules (shared with src/lib/patterns.ts)
  llm.py           Gemini client and run modes
  fixtures/        Sample class and captured replay
  tests/           stdlib unittest suite
scripts/scope_check.py   Pre-commit scope gate
public/                  logo.png, icon-192.png, icon-512.png,
                         manifest.webmanifest, agents/ (pipeline avatars)
```

---

## Content status

Cards, comprehension questions, activities and tips, the rubric thresholds and the pattern rules are drafts. They need an educator's review before a real pilot.
