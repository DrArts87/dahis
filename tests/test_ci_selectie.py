"""Tests van tools/ci_selectie.py (issue #26): bij twijfel draait alles."""
import io
import os
import sys
import unittest
from contextlib import redirect_stdout, redirect_stderr

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import ci_selectie  # noqa: E402


class SelectieTest(unittest.TestCase):
    def test_alleen_documentatie_slaat_over(self):
        self.assertFalse(ci_selectie.volledig("pull_request", ["docs/plans/x.md", "CLAUDE.md", "docs/ui/a.png"]))

    def test_code_of_tests_draait_alles(self):
        for pad in ["app/js/vault.js", "tests/dom.test.mjs", "tools/release.py", ".github/workflows/controle.yml",
                    "app/README.md", ".github/pull_request_template.md", "docs"]:
            self.assertTrue(ci_selectie.volledig("pull_request", ["docs/a.md", pad]), pad)

    def test_lege_diff_of_ander_event_draait_alles(self):
        self.assertTrue(ci_selectie.volledig("pull_request", []))
        self.assertTrue(ci_selectie.volledig("pull_request", ["", "  "]))
        for event in ["push", "workflow_dispatch", ""]:
            self.assertTrue(ci_selectie.volledig(event, ["docs/a.md"]), event)

    def test_uitvoer(self):
        out = io.StringIO()
        sys.stdin = io.StringIO("docs/a.md\nSECURITY.md\n")
        try:
            with redirect_stdout(out), redirect_stderr(io.StringIO()):
                ci_selectie.main(["ci_selectie.py", "pull_request"])
        finally:
            sys.stdin = sys.__stdin__
        self.assertEqual(out.getvalue().strip(), "volledig=0")


if __name__ == "__main__":
    unittest.main()
