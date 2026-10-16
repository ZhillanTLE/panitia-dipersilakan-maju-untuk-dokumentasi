"""
Vercel entry point for the planner API. Vercel routes /api/planner/* here (vercel.json) and serves
the Flask app as a Python serverless function on the same origin as the site. Planner state lives in
/tmp, which is per instance and temporary: fine for a demo, not for a real class.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("PLANNER_STATE_DIR", "/tmp/planner-state")

from planner.app import create_app  # noqa: E402

app = create_app()
