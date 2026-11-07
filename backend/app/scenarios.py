"""Validate authored packages once and expose immutable briefing material."""

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
from types import MappingProxyType

from .rules import MINIMUM_TO_START, ROOM_CAPACITY


@dataclass(frozen=True)
class PublicDocument:
    id: str
    text: str


@dataclass(frozen=True)
class Role:
    role_id: str
    name: str


@dataclass(frozen=True)
class Timing:
    profile_id: str
    briefing_seconds: int


@dataclass(frozen=True)
class Scenario:
    scenario_id: str
    version: int
    title: str
    content_sha256: str
    roles: tuple[Role, ...]
    timings: tuple[Timing, ...]
    initial_node_id: str
    initial_metrics: tuple[tuple[str, int], ...]
    public_documents: tuple[PublicDocument, ...]


def _object(value, label):
    if type(value) is not dict:
        raise ValueError(f"{label} must be an object")
    return value


def _items(value, label):
    if type(value) is not list or not value:
        raise ValueError(f"{label} must be a nonempty array")
    return value


def _text(value, label):
    if type(value) is not str or not value.strip():
        raise ValueError(f"{label} must be a nonempty string")
    return value


def _integer(value, label, *, positive=False):
    if type(value) is not int or (positive and value <= 0):
        raise ValueError(f"{label} must be {'a positive' if positive else 'an'} integer")
    return value


def _unique_objects(value, label):
    result = {}
    for item in _items(value, label):
        item = _object(item, label)
        identity = _text(item.get("id"), f"{label}.id")
        if identity in result:
            raise ValueError(f"Duplicate {label} ID: {identity}")
        result[identity] = item
    return result


def _json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def _reject_constant(value):
    raise ValueError(f"Nonfinite JSON number: {value}")


def _facts(value, label):
    value = _object(value, label)
    for key, item in value.items():
        _text(key, label)
        if item is not None and type(item) not in (str, int, bool):
            raise ValueError(f"{label}.{key} must be a scalar fact")
    return value


def _validate_metrics(data):
    initial = _object(data.get("initial_metrics"), "initial_metrics")
    bounds = _object(data.get("metric_bounds"), "metric_bounds")
    if not initial or initial.keys() != bounds.keys():
        raise ValueError("Metric bounds must match the initial metrics")
    for name, initial_value in initial.items():
        _text(name, "metric name")
        limit = _object(bounds[name], f"metric_bounds.{name}")
        lower = _integer(limit.get("minimum"), "metric minimum")
        upper = _integer(limit.get("maximum"), "metric maximum")
        value = _integer(initial_value, f"initial_metrics.{name}")
        if lower >= upper or not lower <= value <= upper:
            raise ValueError(f"Invalid initial value or bounds for metric {name}")
    return initial, bounds


def _validate_nodes(data, initial, bounds):
    nodes = _unique_objects(data.get("nodes"), "nodes")
    first = _text(data.get("initial_node_id"), "initial_node_id")
    if first not in nodes:
        raise ValueError("Initial node does not exist")
    facts = _facts(data.get("initial_facts"), "initial_facts")
    all_options, all_outcomes, edges = set(), set(), {}
    for node_id, node in nodes.items():
        for key in ("story_time", "title", "inject"):
            _text(node.get(key), f"nodes.{node_id}.{key}")
        for key in ("study_questions", "custom_rubric"):
            for item in _items(node.get(key), f"nodes.{node_id}.{key}"):
                _text(item, key)
        if any(name not in facts for name in re.findall(r"\{\{([^{}]+)\}\}", node["inject"])):
            raise ValueError(f"Unknown fact placeholder in node {node_id}")
        options = _unique_objects(node.get("options"), "options")
        outcomes = _unique_objects(node.get("outcomes"), "outcomes")
        if all_options.intersection(options) or all_outcomes.intersection(outcomes):
            raise ValueError("Option and outcome IDs must be unique across nodes")
        all_options.update(options)
        all_outcomes.update(outcomes)
        no_decision = _text(node.get("no_decision_outcome_id"), "no_decision_outcome_id")
        if no_decision not in outcomes:
            raise ValueError(f"Unknown no decision outcome in {node_id}")
        preferred = _text(node.get("preferred_option_id"), "preferred_option_id")
        if preferred not in options:
            raise ValueError(f"Unknown preferred option in {node_id}")
        custom = _items(node.get("allowed_custom_outcome_ids"), "allowed_custom_outcome_ids")
        for item in custom:
            _text(item, "custom outcome ID")
        if len(set(custom)) != len(custom) or not set(custom) <= outcomes.keys() or no_decision in custom:
            raise ValueError(f"Invalid allowed custom outcomes in {node_id}")
        used = {no_decision, *custom}
        for option in options.values():
            if option.get("kind") != "prepared":
                raise ValueError("Authored options must have kind prepared")
            _text(option.get("label"), "option label")
            target = _text(option.get("outcome_id"), "option outcome_id")
            if target not in outcomes:
                raise ValueError(f"Unknown option outcome in {node_id}")
            used.add(target)
        if used != outcomes.keys():
            raise ValueError(f"Unselectable outcome in {node_id}")
        edges[node_id] = set()
        for outcome in outcomes.values():
            _text(outcome.get("summary"), "outcome summary")
            deltas = _object(outcome.get("metric_deltas"), "metric_deltas")
            if deltas.keys() != initial.keys():
                raise ValueError("Outcome metric deltas must match initial metrics")
            for name, delta in deltas.items():
                delta = _integer(delta, f"metric_deltas.{name}")
                if abs(delta) > bounds[name]["maximum"] - bounds[name]["minimum"]:
                    raise ValueError(f"Metric delta exceeds bounds for {name}")
            updates = _facts(outcome.get("fact_updates"), "fact_updates")
            if not updates.keys() <= facts.keys():
                raise ValueError("Outcome updates an unknown fact")
            for name, value in updates.items():
                if type(value) is not type(facts[name]):
                    raise ValueError(f"Outcome changes fact type for {name}")
            terminal = outcome.get("terminal")
            if type(terminal) is not bool or "next_node_id" not in outcome:
                raise ValueError("Outcome needs terminal and next_node_id")
            target = outcome["next_node_id"]
            if terminal:
                if target is not None:
                    raise ValueError("Terminal outcome cannot have a next node")
                _text(outcome.get("ending_label"), "ending_label")
            else:
                target = _text(target, "next_node_id")
                if target not in nodes:
                    raise ValueError("Outcome references an unknown next node")
                edges[node_id].add(target)

    visiting, depth = set(), {}

    def visit(node_id):
        if node_id in visiting:
            raise ValueError("Scenario contains a cycle")
        if node_id not in depth:
            visiting.add(node_id)
            depth[node_id] = 1 + max((visit(target) for target in edges[node_id]), default=0)
            visiting.remove(node_id)
        return depth[node_id]

    rounds = visit(first)
    if depth.keys() != nodes.keys():
        raise ValueError("Scenario contains unreachable nodes")
    return rounds


def _validate_timings(data, rounds):
    profiles = _object(data.get("timing_profiles"), "timing_profiles")
    if not profiles:
        raise ValueError("At least one timing profile is required")
    timings = []
    durations = (
        "briefing_seconds", "reading_seconds_per_round", "discussion_seconds_per_round",
        "voting_seconds_per_round", "result_seconds_per_round", "tie_seconds_per_round_max",
        "debrief_seconds", "round_count", "base_total_seconds", "all_ties_total_seconds",
        "experience_ceiling_seconds", "gameplay_ceiling_from_briefing_start_seconds",
        "gameplay_ceiling_after_briefing_seconds", "speaker_max_seconds",
    )
    for name, value in profiles.items():
        _text(name, "timing profile ID")
        value = _object(value, "timing profile")
        for key in durations:
            _integer(value.get(key), f"timing.{name}.{key}", positive=True)
        if value["voting_seconds_per_round"] != 60 or value["round_count"] != rounds:
            raise ValueError("Timing needs a 60 second vote and matching round count")
        base = value["briefing_seconds"] + value["debrief_seconds"] + rounds * sum(
            value[key] for key in (
                "reading_seconds_per_round", "discussion_seconds_per_round",
                "voting_seconds_per_round", "result_seconds_per_round",
            )
        )
        if value["base_total_seconds"] != base or value["all_ties_total_seconds"] != (
            base + rounds * value["tie_seconds_per_round_max"]
        ) or value["all_ties_total_seconds"] > value["experience_ceiling_seconds"]:
            raise ValueError("Timing totals are inconsistent")
        if value["gameplay_ceiling_from_briefing_start_seconds"] + value["debrief_seconds"] != (
            value["experience_ceiling_seconds"]
        ) or value["gameplay_ceiling_after_briefing_seconds"] + value["briefing_seconds"] != (
            value["gameplay_ceiling_from_briefing_start_seconds"]
        ):
            raise ValueError("Gameplay timing ceilings are inconsistent")
        _text(value.get("speaker_allocation"), "speaker_allocation")
        _text(value.get("unused_speaking_seconds"), "unused_speaking_seconds")
        if type(value.get("result_window_includes_ai")) is not bool:
            raise ValueError("result_window_includes_ai must be boolean")
        timings.append(Timing(name, value["briefing_seconds"]))
    vote = _object(data.get("vote_policy"), "vote_policy")
    if type(vote.get("duration_seconds")) is not int or vote["duration_seconds"] != 60:
        raise ValueError("vote_policy must specify 60 seconds")
    return tuple(timings)


def _documents(data, package, digest):
    documents = _unique_objects(data.get("public_documents"), "public_documents")
    result = []
    root = package.resolve()
    for document_id, item in documents.items():
        name = _text(item.get("path"), "document path")
        path = PurePosixPath(name)
        if path.is_absolute() or PureWindowsPath(name).drive or "\\" in name or ".." in path.parts:
            raise ValueError("Public document path must stay inside its package")
        target = (root / path).resolve()
        if not target.is_relative_to(root):
            raise ValueError("Public document resolves outside its package")
        if item.get("unlock") != "before_round_1":
            raise ValueError("Only initial public briefing documents are supported")
        raw = target.read_bytes()
        text = raw.decode("utf-8")
        if not text.strip():
            raise ValueError("Public documents must not be empty")
        for piece in (document_id.encode("utf-8"), name.encode("utf-8"), raw):
            digest.update(len(piece).to_bytes(8, "big"))
            digest.update(piece)
        result.append(PublicDocument(document_id, text))
    return tuple(result)


def _load(path):
    try:
        raw = path.read_bytes()
        data = _object(json.loads(
            raw.decode("utf-8"), object_pairs_hook=_json_object, parse_constant=_reject_constant,
        ), "scenario")
        if data.get("schema_version") != "draft.1":
            raise ValueError("Unsupported scenario schema")
        identity = _text(data.get("scenario_id"), "scenario_id")
        version = _integer(data.get("version"), "version", positive=True)
        title = _text(data.get("title"), "title")
        constraints = _object(data.get("room_constraints"), "room_constraints")
        if type(constraints.get("minimum_to_start")) is not int or type(constraints.get("capacity")) is not int:
            raise ValueError("Room constraints must be integers")
        if constraints != {"minimum_to_start": MINIMUM_TO_START, "capacity": ROOM_CAPACITY}:
            raise ValueError(f"Scenario requires minimum {MINIMUM_TO_START} and capacity {ROOM_CAPACITY}")
        roles = _unique_objects(data.get("roles"), "roles")
        if "ceo" not in roles:
            raise ValueError("Exactly one CEO role definition is required")
        role_values = tuple(Role(key, _text(item.get("name"), "role name")) for key, item in roles.items())
        initial, bounds = _validate_metrics(data)
        rounds = _validate_nodes(data, initial, bounds)
        timings = _validate_timings(data, rounds)
        digest = hashlib.sha256()
        digest.update(len(raw).to_bytes(8, "big"))
        digest.update(raw)
        documents = _documents(data, path.parent, digest)
        return Scenario(identity, version, title, digest.hexdigest(), role_values, timings,
                        data["initial_node_id"], tuple(initial.items()), documents)
    except (OSError, UnicodeError, ValueError) as error:
        raise ValueError(f"Invalid scenario package {path}: {error}") from error


class ScenarioCatalog:
    """Startup validated immutable values. Lookups perform no filesystem I/O."""

    def __init__(self, packages: tuple[Path, ...] | None = None):
        if packages is None:
            packages = (Path(__file__).resolve().parents[2] / "scenarios/cybersecurity_demo/v2/scenario.json",)
        if type(packages) is not tuple or any(not isinstance(path, Path) for path in packages):
            raise ValueError("packages must be a tuple of scenario.json Paths")
        scenarios = {}
        for path in packages:
            if path.name != "scenario.json":
                raise ValueError("Package path must name scenario.json")
            scenario = _load(path)
            identity = (scenario.scenario_id, scenario.version)
            if identity in scenarios:
                raise ValueError(f"Duplicate scenario identity: {identity}")
            scenarios[identity] = scenario
        self._scenarios = MappingProxyType(scenarios)
        self._all = tuple(scenarios.values())

    def get(self, scenario_id: str, version: int) -> Scenario | None:
        return self._scenarios.get((scenario_id, version))

    def all(self) -> tuple[Scenario, ...]:
        return self._all
