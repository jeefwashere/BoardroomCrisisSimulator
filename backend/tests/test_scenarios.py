"""Package admission checks use copies and never change authored fixtures."""

from dataclasses import FrozenInstanceError, asdict
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from backend.app.scenarios import Node, Outcome, PreparedOption, ScenarioCatalog


PACKAGE = Path(__file__).resolve().parents[2] / "scenarios/cybersecurity_demo/v3"


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

    def test_default_catalog_loads_only_v3_and_retains_execution_data(self):
        catalog = ScenarioCatalog()
        scenario = catalog.get("maplecart_cybersecurity", 3)
        self.assertIsNotNone(scenario)
        # The active catalog admits cybersecurity v3 first, then the Cedar Bridge T01 demo package.
        self.assertEqual(catalog.all(), (scenario, catalog.get("cedar_bridge_t01", 1)))
        self.assertEqual(scenario.initial_node_id, "containment")
        self.assertEqual(dict(scenario.initial_facts), self.data["initial_facts"])
        self.assertNotIn("initial_metrics", asdict(scenario))
        self.assertEqual(tuple(node.node_id for node in scenario.nodes),
                         ("containment", "communication", "recovery"))
        for authored, node in zip(self.data["nodes"], scenario.nodes):
            self.assertIsInstance(node, Node)
            self.assertEqual((node.title, node.inject, node.study_questions),
                             (authored["title"], authored["inject"], tuple(authored["study_questions"])))
            self.assertEqual(node.no_decision_outcome_id, authored["no_decision_outcome_id"])
            self.assertEqual(node.options, tuple(PreparedOption(
                item["id"], item["label"], item["outcome_id"],
            ) for item in authored["options"]))
            self.assertEqual(node.outcomes, tuple(Outcome(
                item["id"], item["summary"], tuple(item["fact_updates"].items()),
                item["next_node_id"], item["terminal"], item.get("ending_label"),
            ) for item in authored["outcomes"]))
        # Partial communication updates must not acquire fabricated reset values.
        self.assertEqual(scenario.nodes[1].outcomes[0].fact_updates,
                         (("communication_status", "factual_update_and_owned_followup"),))
        self.assertEqual({role.role_id for role in scenario.roles}, {
            "ceo", "security", "technology", "finance", "operations", "communications_privacy",
        })
        self.assertEqual({timing.profile_id for timing in scenario.timings}, {"standard_18", "fast_15"})
        self.assertTrue(all(timing.briefing_seconds == 90 for timing in scenario.timings))
        self.assertEqual({document.id for document in scenario.public_documents}, {
            "briefing", "initial_evidence", "operations",
        })
        self.assertTrue(all(timing.result_seconds == 30 for timing in scenario.timings))
        self.assertIsNone(catalog.get("maplecart_cybersecurity", 2))
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
            (scenario.nodes[0], "inject", "Replacement"),
            (scenario.nodes[0].options[0], "label", "Replacement"),
            (scenario.nodes[0].outcomes[0], "summary", "Replacement"),
        ):
            with self.assertRaises(FrozenInstanceError):
                setattr(instance, name, value)
        with self.assertRaises(TypeError):
            scenario.initial_facts[0] = ("verified_export_records", 1)
        with self.assertRaises(TypeError):
            scenario.nodes[0].options[0] = scenario.nodes[0].options[1]
        with self.assertRaises(TypeError):
            scenario.nodes[0].outcomes[0].fact_updates[0] = ("verified_export_records", 999)
        self.data["nodes"][0]["outcomes"][0]["fact_updates"]["verified_export_records"] = 999
        self.assertEqual(dict(scenario.nodes[0].outcomes[0].fact_updates)["verified_export_records"], 160)
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
        self.path.write_text('{"schema_version":"draft.2","schema_version":"draft.2"}')
        with self.assertRaisesRegex(ValueError, "Duplicate JSON key"):
            ScenarioCatalog((self.path,))

    def test_legacy_meter_fields_are_rejected_at_every_depth(self):
        for key in ("initial_metrics", "metric_bounds", "metric_deltas", "metric_semantics",
                    "expected_metrics", "metrics", "applied_deltas"):
            for location in ((), ("nodes", 0), ("nodes", 0, "outcomes", 0), ("happy_path",)):
                with self.subTest(key=key, location=location):
                    def change(data):
                        target = data
                        for part in location:
                            target = target[part]
                        target[key] = {"public_trust": 60}
                    self.reject(change)

    def test_legacy_packages_remain_on_disk_but_are_not_admitted(self):
        for version in (1, 2):
            path = PACKAGE.parent / f"v{version}" / "scenario.json"
            with self.subTest(version=version):
                self.assertTrue(path.is_file())
                with self.assertRaisesRegex(ValueError, "Unsupported scenario schema"):
                    ScenarioCatalog((path,))

    def test_facts_accept_only_exact_scalar_types_and_preserve_update_types(self):
        for value in (1.5, [], {}, ["value"]):
            with self.subTest(value=value):
                self.reject(lambda data: data["initial_facts"].update(extra=value))
                self.reject(lambda data: data["nodes"][0]["outcomes"][0]["fact_updates"].update(
                    verified_export_records=value))
        for initial, update in ((0, True), (False, 1), (None, "known"), ("unknown", None)):
            with self.subTest(initial=initial, update=update):
                def change(data):
                    data["initial_facts"]["extra"] = initial
                    data["nodes"][0]["outcomes"][0]["fact_updates"]["extra"] = update
                self.reject(change)
        for initial, update in ((0, 3), (False, True), (None, None), ("unknown", "known")):
            self.data["initial_facts"]["extra"] = initial
            self.data["nodes"][0]["outcomes"][0]["fact_updates"]["extra"] = update
            loaded = self.catalog().all()[0]
            self.assertIs(type(dict(loaded.initial_facts)["extra"]), type(initial))
            self.assertEqual(dict(loaded.nodes[0].outcomes[0].fact_updates)["extra"], update)

    def test_narration_summaries_are_retained_exactly_with_a_500_character_limit(self):
        self.data["nodes"][0]["outcomes"][0]["summary"] = "x" * 500
        loaded = self.catalog().all()[0]
        self.assertEqual(loaded.nodes[0].outcomes[0].summary, "x" * 500)
        self.reject(lambda data: data["nodes"][0]["outcomes"][0].update(summary="x" * 501))
        self.reject(lambda data: data["nodes"][0]["outcomes"][0].update(summary="   "))

    def test_graph_requires_reachable_nodes_and_finite_terminal_paths(self):
        changes = (
            lambda data: data["nodes"][0]["outcomes"][0].update(next_node_id="containment"),
            lambda data: data["nodes"][1]["outcomes"][0].update(next_node_id="containment"),
            lambda data: data.update(initial_node_id="recovery"),
            lambda data: data["nodes"][2]["outcomes"][0].update(next_node_id="containment"),
            lambda data: data["nodes"][0]["outcomes"][0].update(next_node_id=None),
            lambda data: data["nodes"][2]["outcomes"][0].pop("ending_label"),
            lambda data: data["nodes"][0]["outcomes"][0].update(ending_label="not_terminal"),
        )
        for index, change in enumerate(changes):
            with self.subTest(case=index):
                self.reject(change)

    def test_room_roles_schema_and_required_types_are_validated(self):
        changes = (
            lambda data: data.update(schema_version="future"),
            lambda data: data.update(schema_version="draft.1"),
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
            lambda data: data["timing_profiles"]["standard_18"].update(result_seconds_per_round=5),
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
