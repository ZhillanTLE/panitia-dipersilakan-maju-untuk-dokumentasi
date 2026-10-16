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

from planner import agents, approval, checker, config, intake, library, llm, patterns, pipeline, report, store  # noqa: E402
from planner.app import create_app  # noqa: E402
from planner.tests.sample import payload, student  # noqa: E402

CASES = os.path.join(config.ROOT, "src", "lib", "patterns.cases.json")


def live(raw_by_call):
    """Pretend a model is configured and answers with these JSON objects, one per call."""
    answers = iter(raw_by_call)
    return [
        mock.patch.object(llm, "available", return_value=True),
        mock.patch.object(llm, "complete_json", side_effect=lambda *_: next(answers)),
    ]


class Validation(unittest.TestCase):
    def problems(self, mutate) -> list[str]:
        p = payload()
        mutate(p)
        return intake.validate(p)

    def test_a_good_payload_passes(self):
        self.assertEqual(intake.validate(payload()), [])

    def test_unconfirmed_level_is_rejected(self):
        self.assertTrue(any("belum dikonfirmasi" in m for m in self.problems(lambda p: p["students"][0].update(confirmedLevel=None))))

    def test_unknown_level_is_rejected(self):
        self.assertTrue(self.problems(lambda p: p["students"][0].update(confirmedLevel="mahir")))

    def test_old_schema_is_rejected(self):
        self.assertTrue(self.problems(lambda p: p.update(schemaVersion="1.0")))

    def test_audio_names_and_notes_are_rejected_at_any_depth(self):
        for field in ("audio", "name", "nama", "notes", "transcript", "recording"):
            p = payload()
            p["students"][1]["metrics"]["patterns"][0]["examples"][0][field] = "x"
            self.assertTrue(any(field in m for m in intake.validate(p)), field)
        self.assertTrue(self.problems(lambda p: p["students"][0].update(name="Ani")))

    def test_a_clip_may_only_be_a_pointer(self):
        self.assertEqual(self.problems(lambda p: p["students"][1]["metrics"]["patterns"][0]["examples"][0].update(clipId="take-7:3")), [])
        self.assertTrue(self.problems(lambda p: p["students"][1]["metrics"]["patterns"][0]["examples"][0].update(clipId="data:audio/wav;base64,UklGR")))
        self.assertTrue(self.problems(lambda p: p["students"][1]["metrics"]["patterns"][0]["examples"][0].update(clipBytes="UklGR")))

    def test_unit_must_match_the_level(self):
        self.assertTrue(any("satuan" in m for m in self.problems(lambda p: p["students"][3]["metrics"].update(unit="kata"))))
        self.assertTrue(self.problems(lambda p: p["students"][0]["metrics"].update(unit="suku_kata")))  # pemula reads the letter card

    def test_unknown_pattern_ids_are_rejected(self):
        found = self.problems(lambda p: p["students"][3]["metrics"]["patterns"].append({"id": "slow_reader", "count": 1, "examples": []}))
        self.assertTrue(any("slow_reader" in m for m in found))

    def test_comprehension_is_for_paragraf_cards_only(self):
        self.assertTrue(self.problems(lambda p: p["students"][5]["metrics"].update(comprehension={"correct": 1, "asked": 3, "cardUnit": "kata"})))
        self.assertTrue(self.problems(lambda p: p["students"][8]["metrics"].update(comprehension={"correct": 4, "asked": 3, "cardUnit": "paragraf"})))

    def test_metrics_are_required_and_closed(self):
        self.assertTrue(self.problems(lambda p: p["students"][2].pop("metrics")))
        self.assertTrue(any("tidak dikenal" in m for m in self.problems(lambda p: p["students"][2]["metrics"].update(suggestedLevel="kata"))))
        self.assertTrue(self.problems(lambda p: p["students"][2]["metrics"].update(accuracy={"correct": 11, "attempted": 10})))


class Patterns(unittest.TestCase):
    def test_the_shared_cases_match_the_phone(self):
        with open(CASES, encoding="utf-8") as fh:
            cases = json.load(fh)
        for c in cases["classify"]:
            self.assertEqual(patterns.classify(c["expected"], c["heard"]), c["patterns"], c)
        for c in cases["syllables"]:
            self.assertEqual(patterns.syllable_count(patterns.normalize(c["word"])), c["count"], c)

    def test_group_facts_count_children_per_pattern(self):
        groups = {g["level"]: g for g in intake.intake(payload())["groups"]}
        sk = groups["suku_kata"]
        self.assertEqual([(p["id"], p["children"], p["count"]) for p in sk["patterns"]], [("closed_syllable", 2, 4), ("digraph_cluster", 1, 2)])
        self.assertEqual(sk["topPatterns"], ["closed_syllable"])
        self.assertEqual(groups["paragraf"]["topPatterns"], [])
        self.assertEqual(groups["paragraf"]["comprehension"], {"medianCorrect": 2, "medianAsked": 3, "children": 1})
        self.assertEqual(sk["practice"]["medianChange"], 6)

    def test_passages_are_indexed_by_the_shapes_on_the_card(self):
        packs = library.pack_by_pattern("kata")
        self.assertIn("KAT-02", packs["closed_syllable"])
        self.assertIn("SUK-01", library.pack_by_pattern("suku_kata")["letter_confusion"])
        for level in config.LEVELS:
            for ids in library.pack_by_pattern(level).values():
                self.assertTrue(set(ids) <= set(library.pack(level)))


class Agents(unittest.TestCase):
    def test_default_mode_is_mock_and_labelled(self):
        self.assertEqual(llm.inference_mode(), "mock")
        r = pipeline.run(payload())
        self.assertEqual(r["mode"]["inference"], "mock")
        self.assertTrue(r["trace"][1]["writtenBy"].startswith("aturan"))
        self.assertTrue(r["trace"][2]["plannedBy"].startswith("mock"))

    def test_live_without_a_key_refuses(self):
        with mock.patch.dict(os.environ, {"PLANNER_LIVE_INFERENCE": "1"}):
            with self.assertRaises(llm.LiveInferenceUnavailable):
                pipeline.run(payload())
            res = create_app().test_client().post("/api/planner/run", json=payload())
            self.assertEqual(res.status_code, 503)
            self.assertEqual(res.get_json()["reason"], "live_inference_unconfigured")

    def test_the_switch_picks_the_model_per_request(self):
        client = create_app().test_client()
        res = client.post("/api/planner/run?inference=live", json=payload())
        self.assertEqual(res.status_code, 503)  # no key in tests: refused, never faked
        self.assertEqual(client.post("/api/planner/run?inference=mock", json=payload()).get_json()["mode"]["inference"], "mock")
        with mock.patch.dict(os.environ, {"GEMINI_API_KEY": "k"}), mock.patch.object(llm, "complete_json", return_value=None) as call:
            out = client.post("/api/planner/run?inference=live", json=payload()).get_json()
        self.assertEqual(out["mode"]["inference"], "live")
        self.assertTrue(call.called)
        self.assertEqual(llm.inference_mode(), "mock")  # the choice does not outlive the request

    def test_agent_levels_and_metric_fields_are_discarded_and_logged(self):
        info = intake.intake(payload())
        facts = {g["level"]: intake.evidence_facts(g) for g in info["groups"]}
        raw = {"groups": [{"level": "kata", "lines": ["Kelompok Kata: 2 anak."], "newLevel": "paragraf", "correctUnitsPerMinute": 40}, {"level": "mahir", "lines": ["x"]}]}
        with live([raw])[0], live([raw])[1]:
            out = agents.summarize(info["groups"], facts, {"students": 9, "groups": 6})
        fields = [d.get("field") for d in out["discarded"]]
        self.assertIn("newLevel", fields)
        self.assertIn("correctUnitsPerMinute", fields)
        self.assertIn("level", fields)
        self.assertEqual(out["lines"]["kata"], ["Kelompok Kata: 2 anak."])

    def test_planner_fields_outside_the_whitelist_are_discarded(self):
        groups = intake.intake(payload())["groups"]
        raw = {"groups": [{"level": "kata", "sessions": [{"week": 1, "kind": "practice", "activityId": "ACT-KAT-03", "passageIds": [], "minutes": 10, "focus": "closed_syllable", "start": "08:00", "level": "kalimat"}]}]}
        patches = live([raw])
        with patches[0], patches[1]:
            out = agents.plan(groups, {}, [1, 2], {g["level"]: {1: 17, 2: 11} for g in groups})
        self.assertEqual({d["field"] for d in out["discarded"]}, {"start", "level"})
        self.assertNotIn("start", out["sessions"]["kata"][0])

    def test_no_diagnosis_or_ranking_words_in_any_output(self):
        text = json.dumps(pipeline.run(payload()), ensure_ascii=False).lower()
        for word in config.banned_words():
            self.assertNotIn(word, text, word)


class EvidenceChecks(unittest.TestCase):
    def setUp(self):
        self.info = intake.intake(payload())
        self.facts = {g["level"]: intake.evidence_facts(g) for g in self.info["groups"]}
        self.cls = {"students": 9, "groups": 6}

    def check(self, line, level="suku_kata"):
        kept, discarded = checker.check_evidence({level: [line]}, self.facts, self.cls)
        return kept[level], [d["rule"] for d in discarded]

    def test_a_number_that_is_not_a_fact_is_caught(self):
        self.assertEqual(self.check("Kelompok Suku Kata: 2 anak, 2 keliru pada suku kata tertutup."), (["Kelompok Suku Kata: 2 anak, 2 keliru pada suku kata tertutup."], []))
        self.assertEqual(self.check("Kelompok Suku Kata: 3 anak keliru pada suku kata tertutup.")[1], ["number_mismatch"])
        self.assertEqual(self.check("Nilai tengah 21 suku kata benar per menit.")[1], ["number_mismatch"])
        self.assertEqual(self.check("Nilai tengah 20 suku kata benar per menit.")[1], [])

    def test_numbers_in_words_and_decimals_are_checked_too(self):
        self.assertEqual(self.check("Tujuh anak keliru.")[1], ["number_mismatch"])
        self.assertEqual(self.check("Dua anak keliru.")[1], [])
        self.assertEqual(self.check("Dua puluh suku kata benar per menit.")[1], [])
        self.assertEqual(self.check("Nilai tengah 8,5 dari 10.")[1], ["number_mismatch"])
        self.assertEqual(self.check("Dari bacaan pertama ke bacaan ketiga, salah satu anak lebih cepat.")[1], [])

    def test_a_number_from_another_group_is_not_allowed(self):
        self.assertEqual(self.check("Pemahaman: 2 dari 3 pertanyaan.", level="kata")[1], ["number_mismatch"])
        self.assertEqual(self.check("Pemahaman: 2 dari 3 pertanyaan.", level="paragraf")[1], [])

    def test_percent_codes_level_moves_and_banned_words_are_stripped(self):
        self.assertEqual(self.check("Naik 6%.")[1], ["percent"])
        self.assertEqual(self.check("T1-04 keliru 2 kali.")[1], ["child_code"])
        self.assertEqual(self.check("Kelompok ini sebaiknya naik ke tingkat kata.")[1], ["level_move"])
        self.assertEqual(self.check("Ada risiko tertinggal.")[1], ["banned_word"])

    def test_rule_built_lines_always_pass(self):
        for g in self.info["groups"]:
            kept, discarded = checker.check_evidence({g["level"]: agents.rule_evidence(g)}, self.facts, self.cls)
            self.assertEqual(discarded, [], g["level"])
            self.assertTrue(kept[g["level"]])

    def test_a_group_left_without_lines_is_repaired_then_given_rule_lines(self):
        levels = [g["level"] for g in self.info["groups"]]
        first = {"groups": [{"level": lv, "lines": ["Kelompok ini: 99 anak."] if lv == "kata" else [agents.rule_evidence(g)[0]]} for lv, g in zip(levels, self.info["groups"])]}
        bad_again = {"groups": [{"level": "kata", "lines": ["Kelompok Kata: 98 anak."]}]}
        good_plan = {"groups": [{"level": g["level"], "sessions": s} for g, s in zip(self.info["groups"], [[]] * 6)]}
        patches = live([first, bad_again, bad_again, good_plan, good_plan, good_plan])
        with patches[0], patches[1]:
            r = pipeline.run(payload())
        ev = r["trace"][1]
        self.assertEqual(ev["repairs"], config.REPAIR_ATTEMPTS)
        self.assertEqual(ev["ruleBuilt"], ["kata"])
        self.assertEqual(ev["writtenBy"], "gemini (sebagian aturan)")
        self.assertEqual(ev["lines"]["kata"], agents.rule_evidence(next(g for g in self.info["groups"] if g["level"] == "kata")))
        self.assertEqual(sum(1 for d in ev["discarded"] if d.get("rule") == "number_mismatch"), 3)
        self.assertEqual(r["trace"][3]["evidence"]["discarded"], 3)


class Checking(unittest.TestCase):
    def setUp(self):
        self.p = payload()
        self.info = intake.intake(self.p)
        self.weeks = [1, 2]
        self.budgets = {g["level"]: {1: 35, 2: 23} for g in self.info["groups"]}

    def test_default_plan_always_passes_and_targets_the_top_pattern(self):
        s = agents.default_plan(self.info["groups"], self.weeks, self.budgets)
        self.assertEqual(checker.check(s, self.info["groups"], self.weeks, self.budgets), [])
        for g in self.info["groups"]:
            focus = {x["focus"] for x in s[g["level"]] if x["kind"] == "practice"}
            self.assertEqual(focus, {g["topPatterns"][0]} if g["topPatterns"] else {None}, g["level"])

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
        self.assertIn("focus", failing(lambda s: s["kata"][0].update(focus="affixed_word")))
        self.assertIn("focus", failing(lambda s: s["kata"][0].update(focus="kelompok dengan risiko")))
        self.assertIn("focus", failing(lambda s: s["paragraf"][0].update(focus="long_word")))
        self.assertIn("first_focus", failing(lambda s: s["suku_kata"][0].update(focus="digraph_cluster")))
        self.assertIn("replacement", failing(lambda s: s["kata"].__setitem__(slice(None), [x for x in s["kata"] if x["kind"] != "replacement"])))
        self.assertIn("replacement_week", failing(lambda s: [x.update(week=1) for x in s["kata"] if x["kind"] == "replacement"]))
        self.assertIn("budget", failing(lambda s: s["kata"].extend(dict(s["kata"][0]) for _ in range(5))))

    def test_forced_failure_gives_a_labelled_fallback_never_an_invalid_plan(self):
        bad = lambda groups, ev, weeks, budgets, repair=None, carry=None, skip=None: {  # noqa: E731
            "sessions": {g["level"]: [{"week": 1, "kind": "practice", "activityId": "NOPE", "passageIds": [], "minutes": 5, "focus": None}] for g in groups},
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

    def test_no_agent_can_change_a_level_or_a_metric(self):
        p = payload()
        before = copy.deepcopy(p)
        bad_evidence = {"groups": [{"level": "kata", "lines": ["Kelompok Kata: 2 anak."], "confirmedLevel": "paragraf", "metrics": {"correctUnitsPerMinute": 99}}]}
        bad_plan = {"groups": [{"level": "kata", "sessions": [{"week": 1, "kind": "practice", "activityId": "ACT-KAT-03", "passageIds": [], "minutes": 10, "focus": "closed_syllable", "confirmedLevel": "paragraf"}]}]}
        patches = live([bad_evidence, bad_evidence, bad_evidence, bad_plan, bad_plan, bad_plan])
        with patches[0], patches[1]:
            r = pipeline.run(p)
        self.assertEqual(p, before)
        self.assertEqual(r["plan"]["levelsAtStart"], {s["code"]: s["confirmedLevel"] for s in before["students"]})
        self.assertEqual(r["plan"]["speedAtStart"], {s["code"]: {"value": s["metrics"]["correctUnitsPerMinute"], "unit": s["metrics"]["unit"]} for s in before["students"]})
        for g in r["plan"]["groups"]:
            self.assertEqual(sorted(g["students"]), sorted(s["code"] for s in before["students"] if s["confirmedLevel"] == g["level"]))
        discarded = {d.get("field") for d in r["trace"][1]["discarded"]} | {d.get("field") for d in r["trace"][2]["discarded"]}
        self.assertTrue({"confirmedLevel", "metrics"} <= discarded)


class Scheduling(unittest.TestCase):
    def test_holiday_is_skipped_and_replacement_is_in_the_last_week(self):
        r = pipeline.run(payload())
        dates = {e["date"] for e in r["calendar"]["events"]}
        self.assertNotIn("2026-10-28", dates)
        for e in r["calendar"]["events"]:
            if e["kind"] == "replacement":
                self.assertEqual(e["week"], 2)

    def test_each_session_carries_its_focus(self):
        r = pipeline.run(payload())
        practice = [e for e in r["calendar"]["events"] if e["kind"] == "practice"]
        self.assertTrue(practice)
        for e in practice:
            self.assertIn(e["focus"], patterns.IDS + [None])
        self.assertIn("closed_syllable", {e["focus"] for e in practice if e["groupLevel"] == "suku_kata"})

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

    def test_the_trace_is_kept_with_the_draft_and_the_approval(self):
        r = self.draft()
        self.assertEqual(len(store.load("T1")["draft"]["trace"]), 5)
        approval.approve("T1", r["plan"]["id"], r["calendar"]["events"])
        self.assertEqual(len(store.load("T1")["approved"]["trace"]), 5)

    def test_nothing_reaches_the_phone_before_approval(self):
        store.save("T9", {})
        self.assertFalse(approval.phone_pull("T9")["approved"])

    def test_any_free_hour_of_a_school_day_is_allowed(self):
        r = self.draft()
        events = copy.deepcopy(r["calendar"]["events"])
        e = next(x for x in events if x["kind"] == "practice" and x["week"] == 1)
        e.update(date="2026-10-20", day="Tue", start="11:00", end=f"11:{e['minutes']:02d}")  # no literacy period on Tuesday
        self.assertTrue(approval.approve("T1", r["plan"]["id"], events)["queuedForPhone"])

    def test_a_move_outside_the_school_day_a_holiday_or_a_weekend_is_refused(self):
        r = self.draft()
        for change in (
            {"start": "16:00", "end": None},
            {"date": "2026-10-28", "day": "Wed"},
            {"date": "2026-10-24", "day": "Sat"},
            {"date": "2026-10-27", "day": "Tue"},  # right day, but the week no longer matches
        ):
            events = copy.deepcopy(r["calendar"]["events"])
            e = next(x for x in events if x["kind"] == "practice" and x["week"] == 1)
            if change.get("end", 1) is None:
                change = {"start": "16:00", "end": f"16:{e['minutes']:02d}"}
            e.update(change)
            with self.assertRaises(ValueError, msg=str(change)):
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
        self.assertEqual(r2["plan"]["speedAtStart"], r["plan"]["speedAtStart"])

    def test_a_group_replaced_early_gets_no_second_replacement(self):
        p = payload()
        r = pipeline.run(p)
        approved = {"plan": r["plan"], "calendar": r["calendar"]}
        r2 = pipeline.run(p, {"fromDate": "2026-10-26", "previous": approved, "done": [], "replacedGroups": ["kata"]})
        self.assertFalse([e for e in r2["calendar"]["events"] if e["groupLevel"] == "kata" and e["kind"] == "replacement"])


class Report(unittest.TestCase):
    def setUp(self):
        p = payload()
        r = pipeline.run(p)
        store.save_draft("T1", r, p)
        approval.approve("T1", r["plan"]["id"], r["calendar"]["events"])
        self.p = p
        self.approved = store.load("T1")["approved"]

    def build(self, p2):
        return report.build(p2, self.approved["plan"], self.approved["calendar"])

    def test_counts_only_each_child_against_their_own_start(self):
        p2 = copy.deepcopy(self.p)
        # T1-04 suku_kata -> kata: a different unit, so no speed after. T1-05 re-placed at the same level.
        p2["students"][3] = student("T1-04", "kata", [], confirmedAt="2026-11-02")
        p2["students"][4] = student("T1-05", "suku_kata", ["digraph_cluster"], confirmedAt="2026-11-02")
        p2["students"][4]["metrics"]["correctUnitsPerMinute"] = 26
        out = self.build(p2)
        sk = next(g for g in out["groups"] if g["level"] == "suku_kata")
        self.assertEqual(sk["moved"], {"up": 1, "stayed": 1, "down": 0, "notYet": 0})
        moved = {c["code"]: c for c in sk["children"]}
        self.assertEqual((moved["T1-04"]["before"], moved["T1-04"]["after"], moved["T1-04"]["speedBefore"], moved["T1-04"]["speedAfter"], moved["T1-04"]["unitChanged"]), ("suku_kata", "kata", 20, None, True))
        self.assertEqual((moved["T1-05"]["speedBefore"], moved["T1-05"]["speedAfter"], moved["T1-05"]["unit"]), (20, 26, "suku_kata"))
        kata = next(g for g in out["groups"] if g["level"] == "kata")
        self.assertEqual(kata["moved"]["notYet"], 2)
        text = json.dumps(out)
        self.assertNotIn("%", text)
        order = [g["level"] for g in out["groups"]]
        self.assertEqual(order, [lv for lv in config.LEVELS if lv in order])

    def test_targeted_patterns_are_counted_before_and_after(self):
        p2 = copy.deepcopy(self.p)
        p2["students"][3] = student("T1-04", "suku_kata", [], confirmedAt="2026-11-02")
        p2["students"][4] = student("T1-05", "suku_kata", ["closed_syllable"], confirmedAt="2026-11-02")
        sk = next(g for g in self.build(p2)["groups"] if g["level"] == "suku_kata")
        self.assertEqual(sk["patterns"], [{"id": "closed_syllable", "label": "Suku kata tertutup", "children": 2, "before": 2, "after": 1}])


class Replay(unittest.TestCase):
    def test_replay_runs_offline_from_the_captured_sample(self):
        with open(os.path.join(config.FIXTURE_DIR, "K2.sync.json"), encoding="utf-8") as fh:
            sample = json.load(fh)
        self.assertEqual(intake.validate(sample), [])
        with mock.patch.dict(os.environ, {"PLANNER_FIXTURES": "1"}), mock.patch.object(llm, "complete_json", side_effect=AssertionError("model called")):
            res = create_app().test_client().post("/api/planner/run", json=sample)
        data = res.get_json()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(data["mode"]["inference"], "replay")
        self.assertEqual([t["stage"] for t in data["trace"]], ["intake", "evidence", "planner", "checker", "scheduler"])
        text = json.dumps(data, ensure_ascii=False).lower()
        for word in config.banned_words():
            self.assertNotIn(word, text, word)


class Privacy(unittest.TestCase):
    def test_stored_state_has_no_names_or_audio(self):
        p = payload()
        r = pipeline.run(p)
        store.save_draft("T1", r, p)
        raw = json.dumps(store.load("T1")).lower()
        for field in ("audio", "transcript", "notes", '"nama"'):
            self.assertNotIn(field, raw)


if __name__ == "__main__":
    unittest.main()
