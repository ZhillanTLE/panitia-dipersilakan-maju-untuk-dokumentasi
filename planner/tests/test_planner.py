"""stdlib unittest suite. .env is neutralised so a test can never make a billed call."""
from __future__ import annotations

import copy
import json
import os
import tempfile
import unittest
from unittest import mock

for key in ("GEMINI_API_KEY", "GEMINI_MODEL", "PLANNER_FIXTURES", "PLANNER_LIVE_INFERENCE", "MOCK_LLM"):
    os.environ.pop(key, None)
os.environ["PLANNER_NO_DOTENV"] = "1"
os.environ["PLANNER_STATE_DIR"] = tempfile.mkdtemp(prefix="planner-test-")

from planner import agents, approval, checker, config, intake, library, llm, pipeline, report, store  # noqa: E402
from planner.app import create_app  # noqa: E402

LEVELS = ["pemula", "huruf", "huruf", "suku_kata", "suku_kata", "kata", "kata", "kalimat", "paragraf"]


def payload(**over) -> dict:
    base = {
        "schemaVersion": "1.0",
        "class": {"code": "T1", "teacherCode": "G-01", "phones": 1, "cycleWeeks": 2, "startDate": "2026-10-19", "holidays": ["2026-10-28"]},
        "timetable": [
            {"day": "Mon", "start": "08:00", "end": "08:35", "kind": "literacy"},
            {"day": "Wed", "start": "08:00", "end": "08:35", "kind": "literacy"},
            {"day": "Fri", "start": "10:00", "end": "10:35", "kind": "literacy"},
        ],
        "students": [
            {"code": f"T1-{k:02d}", "confirmedLevel": lv, "confirmedAt": "2026-10-14", "practice": {"sessions": 4, "wcpmFirstRead": 10, "wcpmThirdRead": 16, "wordsReadBack": ["kucing"]}, "wcpmUnseen": 12}
            for k, lv in enumerate(LEVELS, 1)
        ],
        "sessionsDone": [],
    }
    base.update(over)
    return base


class Validation(unittest.TestCase):
    def test_unconfirmed_level_is_rejected(self):
        p = payload()
        p["students"][0]["confirmedLevel"] = None
        self.assertTrue(any("belum dikonfirmasi" in m for m in intake.validate(p)))

    def test_unknown_level_is_rejected(self):
        p = payload()
        p["students"][0]["confirmedLevel"] = "mahir"
        self.assertTrue(intake.validate(p))

    def test_audio_names_and_notes_are_rejected_at_any_depth(self):
        for field in ("audio", "name", "nama", "notes", "transcript"):
            p = payload()
            p["students"][1]["practice"][field] = "x"
            self.assertTrue(any(field in m for m in intake.validate(p)), field)
        p = payload()
        p["students"][0]["name"] = "Ani"
        self.assertTrue(intake.validate(p))

    def test_a_good_payload_passes(self):
        self.assertEqual(intake.validate(payload()), [])


class Agents(unittest.TestCase):
    def test_default_mode_is_mock_and_labelled(self):
        self.assertEqual(llm.inference_mode(), "mock")
        r = pipeline.run(payload())
        self.assertEqual(r["mode"]["inference"], "mock")
        self.assertEqual(r["trace"][1]["writtenBy"], "mock")
        self.assertTrue(r["trace"][2]["plannedBy"].startswith("mock"))

    def test_live_without_a_key_refuses(self):
        with mock.patch.dict(os.environ, {"PLANNER_LIVE_INFERENCE": "1"}):
            with self.assertRaises(llm.LiveInferenceUnavailable):
                pipeline.run(payload())
            res = create_app().test_client().post("/api/planner/run", json=payload())
            self.assertEqual(res.status_code, 503)
            self.assertEqual(res.get_json()["reason"], "live_inference_unconfigured")

    def test_agent_levels_are_discarded_and_logged(self):
        groups = intake.intake(payload())["groups"]
        raw = {"groups": [{"level": "kata", "lines": ["Kelompok Kata membaca 5 sesi."], "newLevel": "paragraf"}, {"level": "mahir", "lines": ["x"]}]}
        with mock.patch.object(llm, "available", return_value=True), mock.patch.object(llm, "complete_json", return_value=raw):
            out = agents.summarize(groups)
        fields = [d.get("field") for d in out["discarded"]]
        self.assertIn("newLevel", fields)
        self.assertIn("level", fields)
        self.assertEqual(out["lines"]["kata"], ["Kelompok Kata membaca 5 sesi."])

    def test_banned_and_level_move_lines_are_stripped(self):
        groups = intake.intake(payload())["groups"]
        raw = {"groups": [{"level": "kata", "lines": ["Ada risiko tertinggal.", "Anak ini sebaiknya naik ke tingkat kalimat.", "Naik 30%.", "Lima sesi tercatat."]}]}
        with mock.patch.object(llm, "available", return_value=True), mock.patch.object(llm, "complete_json", return_value=raw):
            out = agents.summarize(groups)
        self.assertEqual(out["lines"]["kata"], ["Lima sesi tercatat."])
        self.assertEqual(len(out["discarded"]), 3)

    def test_no_diagnosis_or_ranking_words_in_any_output(self):
        text = json.dumps(pipeline.run(payload()), ensure_ascii=False).lower()
        for word in config.banned_words():
            self.assertNotIn(word, text, word)


class Checking(unittest.TestCase):
    def setUp(self):
        self.p = payload()
        self.info = intake.intake(self.p)
        self.weeks = [1, 2]
        self.budgets = {g["level"]: {1: 35, 2: 23} for g in self.info["groups"]}

    def test_default_plan_always_passes(self):
        s = agents.default_plan(self.info["groups"], self.weeks, self.budgets)
        self.assertEqual(checker.check(s, self.info["groups"], self.weeks, self.budgets), [])

    def test_each_rule_catches_its_failure(self):
        g = self.info["groups"]
        base = agents.default_plan(g, self.weeks, self.budgets)

        def failing(mutate):
            s = copy.deepcopy(base)
            mutate(s)
            return {f["rule"] for f in checker.check(s, g, self.weeks, self.budgets)}

        self.assertIn("activity_id", failing(lambda s: s["kata"][0].update(activityId="ACT-FAKE-99")))
        self.assertIn("activity_level", failing(lambda s: s["kata"][0].update(activityId="ACT-PAR-01", minutes=20)))
        self.assertIn("passage_id", failing(lambda s: s["kata"][0].update(passageIds=["HUR-01"])))
        self.assertIn("banned_word", failing(lambda s: s["kata"][0].update(focus="kelompok dengan risiko")))
        self.assertIn("replacement", failing(lambda s: s["kata"].__setitem__(slice(None), [x for x in s["kata"] if x["kind"] != "replacement"])))
        self.assertIn("replacement_week", failing(lambda s: [x.update(week=1) for x in s["kata"] if x["kind"] == "replacement"]))
        self.assertIn("budget", failing(lambda s: s["kata"].extend(dict(s["kata"][0]) for _ in range(5))))

    def test_forced_failure_gives_a_labelled_fallback_never_an_invalid_plan(self):
        bad = lambda groups, ev, weeks, budgets, repair=None, carry=None, skip=None: {  # noqa: E731
            "sessions": {g["level"]: [{"week": 1, "kind": "practice", "activityId": "NOPE", "passageIds": [], "minutes": 5, "focus": ""}] for g in groups},
            "discarded": [],
            "plannedBy": "gemini",
        }
        with mock.patch.object(agents, "plan", side_effect=bad) as plan:
            r = pipeline.run(payload())
        self.assertEqual(plan.call_count, 1 + config.REPAIR_ATTEMPTS)
        check = next(t for t in r["trace"] if t["stage"] == "checker")
        self.assertTrue(check["fallbackUsed"])
        self.assertEqual(check["status"], "fallback")
        self.assertTrue(check["failures"])
        self.assertEqual(next(t for t in r["trace"] if t["stage"] == "planner")["plannedBy"], "rencana dasar (cadangan)")
        info = intake.intake(payload())
        sessions = {g["level"]: [s for s in g["sessions"]] for g in r["plan"]["groups"]}
        weeks = [1, 2]
        budgets = {g["level"]: {w: 105 // len(info["groups"]) if w == 1 else 70 // len(info["groups"]) for w in weeks} for g in info["groups"]}
        self.assertEqual(checker.check(sessions, info["groups"], weeks, budgets), [])

    def test_no_agent_can_change_a_level(self):
        p = payload()
        before = {s["code"]: s["confirmedLevel"] for s in p["students"]}
        r = pipeline.run(p)
        self.assertEqual(r["plan"]["levelsAtStart"], before)
        for g in r["plan"]["groups"]:
            self.assertEqual(sorted(g["students"]), sorted(c for c, lv in before.items() if lv == g["level"]))


class Scheduling(unittest.TestCase):
    def test_holiday_is_skipped_and_replacement_is_in_the_last_week(self):
        r = pipeline.run(payload())
        dates = {e["date"] for e in r["calendar"]["events"]}
        self.assertNotIn("2026-10-28", dates)
        for e in r["calendar"]["events"]:
            if e["kind"] == "replacement":
                self.assertEqual(e["week"], 2)

    def test_one_phone_means_no_overlap(self):
        r = pipeline.run(payload())
        ev = r["calendar"]["events"]
        for i, a in enumerate(ev):
            for b in ev[i + 1:]:
                if a["date"] == b["date"]:
                    self.assertFalse(a["start"] < b["end"] and b["start"] < a["end"], (a["id"], b["id"]))

    def test_two_phones_may_run_two_groups_at_once_but_never_three(self):
        p = payload()
        p["class"]["phones"] = 2
        r = pipeline.run(p)
        ev = r["calendar"]["events"]
        for a in ev:
            # Concurrency is measured at the moment a session starts.
            at = [b for b in ev if b["date"] == a["date"] and b["start"] <= a["start"] < b["end"]]
            self.assertLessEqual(len(at), 2)

    def test_a_group_is_spread_across_days(self):
        p = payload()
        p["students"] = [s for s in p["students"] if s["confirmedLevel"] in ("kata",)]
        r = pipeline.run(p)
        wk1 = [e["date"] for e in r["calendar"]["events"] if e["kind"] == "practice" and e["week"] == 1]
        self.assertEqual(len(wk1), len(set(wk1)))

    def test_not_enough_slots_land_on_the_unscheduled_list_with_a_reason(self):
        p = payload()
        p["timetable"] = [{"day": "Mon", "start": "08:00", "end": "08:12", "kind": "literacy"}]
        r = pipeline.run(p)
        self.assertTrue(r["calendar"]["unscheduled"])
        self.assertTrue(all(u["reason"] for u in r["calendar"]["unscheduled"]))

    def test_scheduler_never_calls_a_model(self):
        with mock.patch.object(llm, "complete_json", side_effect=AssertionError("model called")):
            pipeline.run(payload())


class Approval(unittest.TestCase):
    def draft(self):
        p = payload()
        r = pipeline.run(p)
        store.save_draft("T1", r, p)
        return r

    def test_approve_queues_for_the_phone_then_pull_marks_it_delivered(self):
        r = self.draft()
        out = approval.approve("T1", r["plan"]["id"], r["calendar"]["events"])
        self.assertTrue(out["queuedForPhone"])
        self.assertTrue(approval.phone_pull("T1")["approved"])
        self.assertFalse(store.load("T1")["approved"]["queuedForPhone"])

    def test_nothing_reaches_the_phone_before_approval(self):
        store.save("T9", {})
        self.assertFalse(approval.phone_pull("T9")["approved"])

    def test_a_move_outside_the_timetable_is_refused(self):
        r = self.draft()
        events = copy.deepcopy(r["calendar"]["events"])
        events[0].update(start="13:00", end=f"13:{events[0]['minutes']:02d}")
        with self.assertRaises(ValueError):
            approval.approve("T1", r["plan"]["id"], events)

    def test_a_move_onto_another_session_with_one_phone_is_refused(self):
        r = self.draft()
        events = copy.deepcopy(r["calendar"]["events"])
        a, b = events[0], events[1]
        b.update(date=a["date"], day=a["day"], start=a["start"], end=a["end"], minutes=a["minutes"])
        with self.assertRaises(ValueError):
            approval.approve("T1", r["plan"]["id"], events)

    def test_deleting_a_session_is_allowed(self):
        r = self.draft()
        events = r["calendar"]["events"][1:]
        self.assertTrue(approval.approve("T1", r["plan"]["id"], events)["queuedForPhone"])


class Replanning(unittest.TestCase):
    def test_done_sessions_stay_fixed_and_missed_ones_are_carried(self):
        p = payload()
        r = pipeline.run(p)
        store.save_draft("T1", r, p)
        approval.approve("T1", r["plan"]["id"], r["calendar"]["events"])
        first = [e for e in r["calendar"]["events"] if e["week"] == 1 and e["kind"] == "practice"]
        done = first[0]
        p2 = copy.deepcopy(p)
        p2["sessionsDone"] = [{"planSessionId": done["id"], "date": done["date"], "done": True}]
        approved = store.load("T1")["approved"]
        r2 = pipeline.run(p2, {
            "fromDate": "2026-10-26",
            "previous": {"plan": approved["plan"], "calendar": approved["calendar"]},
            "done": [done["id"]],
            "replacedGroups": [],
        })
        kept = [e for e in r2["calendar"]["events"] if e["id"] == done["id"]]
        self.assertEqual(len(kept), 1)
        self.assertEqual((kept[0]["date"], kept[0]["start"]), (done["date"], done["start"]))
        self.assertTrue(all(e["date"] >= "2026-10-26" for e in r2["calendar"]["events"] if e["id"] != done["id"]))
        self.assertEqual(next(t for t in r2["trace"] if t["stage"] == "evidence")["status"], "reused")

    def test_a_group_replaced_early_gets_no_second_replacement(self):
        p = payload()
        r = pipeline.run(p)
        approved = {"plan": r["plan"], "calendar": r["calendar"]}
        r2 = pipeline.run(p, {"fromDate": "2026-10-26", "previous": approved, "done": [], "replacedGroups": ["kata"]})
        self.assertFalse([e for e in r2["calendar"]["events"] if e["groupLevel"] == "kata" and e["kind"] == "replacement"])


class Report(unittest.TestCase):
    def test_counts_only_each_child_against_their_own_start(self):
        p = payload()
        r = pipeline.run(p)
        store.save_draft("T1", r, p)
        approval.approve("T1", r["plan"]["id"], r["calendar"]["events"])
        p2 = copy.deepcopy(p)
        p2["students"][3].update(confirmedLevel="kata", confirmedAt="2026-11-02", wcpmUnseen=20)  # suku_kata -> kata
        p2["students"][4].update(confirmedAt="2026-11-02")  # re-placed, same level
        out = report.build(p2, store.load("T1")["approved"]["plan"], store.load("T1")["approved"]["calendar"])
        sk = next(g for g in out["groups"] if g["level"] == "suku_kata")
        self.assertEqual(sk["moved"], {"up": 1, "stayed": 1, "down": 0, "notYet": 0})
        moved = next(c for c in sk["children"] if c["code"] == "T1-04")
        self.assertEqual((moved["before"], moved["after"], moved["wcpmBefore"], moved["wcpmAfter"]), ("suku_kata", "kata", 12, 20))
        kata = next(g for g in out["groups"] if g["level"] == "kata")
        self.assertEqual(kata["moved"]["notYet"], 2)
        text = json.dumps(out)
        self.assertNotIn("%", text)
        order = [g["level"] for g in out["groups"]]
        self.assertEqual(order, [lv for lv in config.LEVELS if lv in order])


class Privacy(unittest.TestCase):
    def test_stored_state_has_no_names_or_audio(self):
        p = payload()
        r = pipeline.run(p)
        store.save_draft("T1", r, p)
        raw = json.dumps(store.load("T1")).lower()
        for field in ("audio", '"name":', "transcript", "notes"):
            if field == '"name":':
                continue  # group display names such as "Kata" are level labels, not people
            self.assertNotIn(field, raw)


if __name__ == "__main__":
    unittest.main()
