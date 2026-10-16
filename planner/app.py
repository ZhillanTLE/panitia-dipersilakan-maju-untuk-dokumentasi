"""
Flask app for the planner. The browser is a client of this API; there is no business logic in the
frontend. One synchronous request per run, the whole reasoning trace in the response body, no
background jobs. Same-origin in dev through the Vite proxy (/api/planner -> :8000).

    python -m planner.app            # PORT defaults to 8000
"""
from __future__ import annotations

import json
import logging
import os

from flask import Flask, jsonify, request

from . import approval, config, llm, pipeline, report, store
from . import intake as intake_mod
from .intake import PayloadError

logger = logging.getLogger(__name__)


def create_app() -> Flask:
    llm.load_env_file()
    app = Flask(__name__)

    def body() -> dict:
        return request.get_json(silent=True) or {}

    def bad(problems: list[str], code: int = 400):
        return jsonify({"error": "Data sinkron tidak lolos validasi.", "problems": problems}), code

    @app.get("/api/planner/health")
    def health():
        return jsonify({
            "mode": {"inference": llm.inference_mode(), "data": "synced"},
            "inferenceConfigured": llm.has_key(),
            "classes": store.count_classes(),
        })

    @app.post("/api/planner/run")
    def run():
        payload = body()
        if llm.inference_mode() == "replay":
            problems = intake_mod.validate(payload)
            return bad(problems, 422) if problems else jsonify(_replay(payload))
        try:
            result = pipeline.run(payload)
        except llm.LiveInferenceUnavailable as exc:
            logger.error("[planner] %s", exc)
            return jsonify({"error": str(exc), "reason": "live_inference_unconfigured"}), 503
        except PayloadError as exc:
            return bad(exc.problems, 422)
        store.save_draft(result["plan"]["classCode"], result, payload)
        return jsonify(result)

    @app.post("/api/planner/approve")
    def approve():
        data = body()
        try:
            out = approval.approve(str(data.get("classCode", "")), str(data.get("planId", "")), data.get("events") or [])
        except LookupError as exc:
            return jsonify({"error": str(exc)}), 404
        except ValueError as exc:
            return jsonify({"error": "Kalender tidak bisa disetujui.", "problems": str(exc).split("; ")}), 422
        return jsonify(out)

    @app.post("/api/planner/replan")
    def replan():
        data = body()
        if llm.inference_mode() == "replay":
            return jsonify({"error": "Rencana ulang tidak tersedia dalam mode rekaman: rekaman tidak menghitung apa pun."}), 409
        payload = data.get("payload") or {}
        class_code = str((payload.get("class") or {}).get("code", ""))
        try:
            previous = (store.load(class_code) or {}).get("approved")
        except ValueError:
            previous = None
        if not previous:
            return jsonify({"error": "Belum ada rencana yang disetujui untuk direncanakan ulang."}), 404
        done = [d["planSessionId"] for d in payload.get("sessionsDone") or [] if d.get("done")]
        try:
            result = pipeline.run(payload, {
                "fromDate": data.get("fromDate"),
                "previous": {"plan": previous["plan"], "calendar": previous["calendar"]},
                "done": done,
                "replacedGroups": data.get("replacedGroups") or [],
            })
        except llm.LiveInferenceUnavailable as exc:
            return jsonify({"error": str(exc), "reason": "live_inference_unconfigured"}), 503
        except PayloadError as exc:
            return bad(exc.problems, 422)
        store.save_draft(class_code, result, payload)
        return jsonify(result)

    @app.post("/api/planner/report")
    def make_report():
        payload = body()
        class_code = str((payload.get("class") or {}).get("code", ""))
        approved = (store.load(class_code) or {}).get("approved")
        if not approved:
            return jsonify({"error": "Belum ada rencana yang disetujui, jadi belum ada laporan siklus."}), 404
        try:
            return jsonify(report.build(payload, approved["plan"], approved["calendar"]))
        except PayloadError as exc:
            return bad(exc.problems, 422)

    @app.get("/api/planner/plan/<class_code>")
    def plan(class_code: str):
        try:
            state = store.load(class_code)
        except ValueError:
            return jsonify({"error": "Kode kelas tidak valid."}), 400
        return jsonify({"draft": state.get("draft"), "approved": state.get("approved")})

    @app.get("/api/planner/phone/<class_code>")
    def phone(class_code: str):
        """The phone's next sync: the approved calendar, once, then it is marked as delivered."""
        try:
            return jsonify(approval.phone_pull(class_code))
        except ValueError:
            return jsonify({"error": "Kode kelas tidak valid."}), 400

    return app


def _replay(payload: dict) -> dict:
    """Replay mode: the captured run for the class, labelled as such. Nothing is computed."""
    code = str((payload.get("class") or {}).get("code", ""))
    path = os.path.join(config.FIXTURE_DIR, f"{code}.golden.json")
    if not os.path.isfile(path):
        return {"error": f"Tidak ada rekaman untuk kelas {code}."}
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    data["mode"] = {"inference": "replay", "data": "captured", "capturedWith": data.get("capturedWith")}
    store.save_draft(code, data, payload)
    return data


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    create_app().run(host="127.0.0.1", port=int(os.environ.get("PORT", "8000")))
