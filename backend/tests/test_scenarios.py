"""Package admission checks use copies and never change authored fixtures."""

from dataclasses import FrozenInstanceError, asdict
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from backend.app.scenarios import ScenarioCatalog


PACKAGE = Path(__file__).resolve().parents[2] / "scenarios/cybersecurity_demo/v2"


class ScenarioCatalogTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.package = self.directory / "package"
        shutil.copytree(PACKAGE, self.package)
        self.path = self.package / "scenario.json"
        self.data = json.loads(self.path.read_text())

    def catalog(self):
        self.path.write_text(json.dumps(self.data), encoding="utf-8")
        return ScenarioCatalog((self.path,))

    def reject(self, change):
        original = json.loads(json.dumps(self.data))
        change(self.data)
        with self.assertRaises(ValueError):
            self.catalog()
        self.data = original

    def test_default_catalog_loads_only_v2_and_projects_no_outcomes(self):
        catalog = ScenarioCatalog()
        scenario = catalog.get("maplecart_cybersecurity", 2)
        self.assertIsNotNone(scenario)
        self.assertEqual(catalog.all(), (scenario,))
        self.assertEqual(scenario.initial_node_id, "containment")
        self.assertEqual(dict(scenario.initial_metrics), {
            "service_continuity": 60, "data_protection": 60, "public_trust": 60,
        })
        self.assertEqual({role.role_id for role in scenario.roles}, {
            "ceo", "security", "technology", "finance", "operations", "communications_privacy",
        })
        self.assertEqual({timing.profile_id for timing in scenario.timings}, {"standard_18", "fast_15"})
        self.assertTrue(all(timing.briefing_seconds == 90 for timing in scenario.timings))
        self.assertEqual({document.id for document in scenario.public_documents}, {
            "briefing", "initial_evidence", "operations",
        })
        self.assertNotIn("outcomes", asdict(scenario))
        self.assertNotIn("nodes", asdict(scenario))
        self.assertNotIn("initial_facts", asdict(scenario))
        self.assertIsNone(catalog.get("maplecart_cybersecurity", 1))
        self.assertIsNone(catalog.get("missing", 2))
        self.assertEqual(ScenarioCatalog(()).all(), ())

    def test_pinned_objects_are_recursively_immutable_and_lookup_never_reads(self):
        catalog = self.catalog()
        scenario = catalog.all()[0]
        for instance, name, value in (
            (scenario, "title", "Replacement"),
            (scenario.roles[0], "name", "Replacement"),
            (scenario.timings[0], "briefing_seconds", 1),
            (scenario.public_documents[0], "text", "Replacement"),
        ):
            with self.assertRaises(FrozenInstanceError):
                setattr(instance, name, value)
        with self.assertRaises(TypeError):
            scenario.initial_metrics[0] = ("service_continuity", 1)
        shutil.rmtree(self.package)
        with patch.object(Path, "read_bytes", side_effect=AssertionError("Lookup attempted I/O")):
            self.assertIs(catalog.get(scenario.scenario_id, scenario.version), scenario)
            self.assertEqual(catalog.all(), (scenario,))

    def test_digest_is_stable_and_covers_json_and_public_document_bytes(self):
        first = self.catalog().all()[0]
        self.assertEqual(len(first.content_sha256), 64)
        self.assertEqual(first.content_sha256, self.catalog().all()[0].content_sha256)
        self.data["title"] += " revised"
        second = self.catalog().all()[0]
        self.assertNotEqual(first.content_sha256, second.content_sha256)
        document = self.package / self.data["public_documents"][0]["path"]
        document.write_bytes(document.read_bytes() + b"\nAdditional public detail.\n")
        third = self.catalog().all()[0]
        self.assertNotEqual(second.content_sha256, third.content_sha256)
        self.assertNotIn("Additional public detail", first.public_documents[0].text)

    def test_references_must_resolve_in_the_owning_node(self):
        changes = (
            lambda data: data.update(initial_node_id="missing"),
            lambda data: data["nodes"][0]["options"][0].update(outcome_id="missing"),
            lambda data: data["nodes"][0]["options"][0].update(outcome_id="factual_update"),
            lambda data: data["nodes"][0].update(no_decision_outcome_id="missing"),
            lambda data: data["nodes"][0].update(preferred_option_id="missing"),
            lambda data: data["nodes"][0]["allowed_custom_outcome_ids"].append("missing"),
            lambda data: data["nodes"][0]["allowed_custom_outcome_ids"].append("containment_no_decision"),
            lambda data: data["nodes"][0]["outcomes"][0].update(next_node_id="missing"),
        )
        for index, change in enumerate(changes):
            with self.subTest(case=index):
                self.reject(change)

    def test_duplicate_ids_are_rejected_in_every_namespace(self):
        changes = (
            lambda data: data["roles"].append(data["roles"][0]),
            lambda data: data["nodes"].append(data["nodes"][0]),
            lambda data: data["public_documents"].append(data["public_documents"][0]),
            lambda data: data["nodes"][0]["options"].append(data["nodes"][0]["options"][0]),
            lambda data: data["nodes"][0]["outcomes"].append(data["nodes"][0]["outcomes"][0]),
            lambda data: data["nodes"][1]["options"][0].update(id="contain_targeted"),
            lambda data: data["nodes"][1]["outcomes"][0].update(id="targeted_containment"),
            lambda data: data["nodes"][0]["allowed_custom_outcome_ids"].append("targeted_containment"),
        )
        for index, change in enumerate(changes):
            with self.subTest(case=index):
                self.reject(change)
        with self.assertRaises(ValueError):
            ScenarioCatalog((self.path, self.path))
        self.path.write_text('{"schema_version":"draft.1","schema_version":"draft.1"}')
        with self.assertRaisesRegex(ValueError, "Duplicate JSON key"):
            ScenarioCatalog((self.path,))

    def test_metric_initial_bounds_and_deltas_are_checked(self):
        changes = (
            lambda data: data["initial_metrics"].update(service_continuity=101),
            lambda data: data["initial_metrics"].update(service_continuity=True),
            lambda data: data["metric_bounds"]["service_continuity"].update(minimum=101),
            lambda data: data["metric_bounds"]["service_continuity"].update(maximum="100"),
            lambda data: data["metric_bounds"].pop("public_trust"),
            lambda data: data["nodes"][0]["outcomes"][0]["metric_deltas"].update(public_trust=101),
            lambda data: data["nodes"][0]["outcomes"][0]["metric_deltas"].update(public_trust=-101),
            lambda data: data["nodes"][0]["outcomes"][0]["metric_deltas"].update(public_trust=0.5),
            lambda data: data["nodes"][0]["outcomes"][0]["metric_deltas"].pop("public_trust"),
        )
        for index, change in enumerate(changes):
            with self.subTest(case=index):
                self.reject(change)
        # Consequences may exceed current metric values; runtime clamps later.
        self.data["nodes"][0]["outcomes"][0]["metric_deltas"]["public_trust"] = 100
        self.assertIsNotNone(self.catalog().all()[0])

    def test_graph_requires_reachable_nodes_and_finite_terminal_paths(self):
        changes = (
            lambda data: data["nodes"][0]["outcomes"][0].update(next_node_id="containment"),
            lambda data: data["nodes"][1]["outcomes"][0].update(next_node_id="containment"),
            lambda data: data.update(initial_node_id="recovery"),
            lambda data: data["nodes"][2]["outcomes"][0].update(next_node_id="containment"),
            lambda data: data["nodes"][0]["outcomes"][0].update(next_node_id=None),
            lambda data: data["nodes"][2]["outcomes"][0].pop("ending_label"),
        )
        for index, change in enumerate(changes):
            with self.subTest(case=index):
                self.reject(change)

    def test_room_roles_schema_and_required_types_are_validated(self):
        changes = (
            lambda data: data.update(schema_version="future"),
            lambda data: data.update(version=True),
            lambda data: data.update(title=[]),
            lambda data: data["room_constraints"].update(capacity=20),
            lambda data: data["room_constraints"].update(minimum_to_start=2),
            lambda data: data["roles"].pop(0),
            lambda data: data["roles"][0].update(name=""),
            lambda data: data["nodes"][0]["options"][0].update(kind="custom"),
            lambda data: data["nodes"][0]["outcomes"][0].update(terminal=0),
            lambda data: data["nodes"][0]["outcomes"][0]["fact_updates"].update(unknown="value"),
            lambda data: data["nodes"][0]["outcomes"][0]["fact_updates"].update(verified_export_records="160"),
            lambda data: data["nodes"][0].update(inject="Unknown {{missing_fact}}"),
        )
        for index, change in enumerate(changes):
            with self.subTest(case=index):
                self.reject(change)

    def test_profile_durations_vote_and_totals_are_validated(self):
        changes = (
            lambda data: data["timing_profiles"]["standard_18"].update(briefing_seconds=0),
            lambda data: data["timing_profiles"]["standard_18"].update(briefing_seconds=True),
            lambda data: data["timing_profiles"]["standard_18"].update(voting_seconds_per_round=30),
            lambda data: data["timing_profiles"]["standard_18"].update(round_count=4),
            lambda data: data["timing_profiles"]["standard_18"].update(base_total_seconds=1),
            lambda data: data["timing_profiles"]["standard_18"].update(experience_ceiling_seconds=1),
            lambda data: data["vote_policy"].update(duration_seconds=59),
        )
        for index, change in enumerate(changes):
            with self.subTest(case=index):
                self.reject(change)

    def test_public_paths_reject_traversal_absolute_windows_and_external_symlinks(self):
        outside = self.directory / "outside.md"
        outside.write_text("Outside package")
        (self.package / "external.md").symlink_to(outside)
        for name in ("../outside.md", str(outside), "C:\\private\\data.md", "external.md"):
            with self.subTest(path=name):
                self.reject(lambda data: data["public_documents"][0].update(path=name))

    def test_missing_empty_invalid_encoding_and_future_documents_fail(self):
        self.reject(lambda data: data["public_documents"][0].update(path="missing.md"))
        self.reject(lambda data: data["public_documents"][0].update(unlock="after_round_1"))
        document = self.package / self.data["public_documents"][0]["path"]
        document.write_bytes(b"  \n")
        with self.assertRaises(ValueError):
            self.catalog()
        document.write_bytes(b"\xff")
        with self.assertRaises(ValueError):
            self.catalog()

    def test_missing_malformed_and_nonfinite_packages_fail_as_value_errors(self):
        with self.assertRaises(ValueError):
            ScenarioCatalog((self.directory / "missing/scenario.json",))
        for raw in ("not JSON", "[]", '{"version":NaN}', "{}"):
            with self.subTest(raw=raw):
                self.path.write_text(raw)
                with self.assertRaises(ValueError):
                    ScenarioCatalog((self.path,))


if __name__ == "__main__":
    unittest.main()
