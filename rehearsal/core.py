import copy
from contextlib import contextmanager
import hashlib
import json
import re
import secrets
import sqlite3
import threading
import time
import uuid
from pathlib import Path

from .scenario import CHARACTERS, DOCUMENTS, OPENING, next_event, preparation


class Problem(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def required(data, key, limit=2000):
    value = data.get(key)
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise Problem(f"{key} must be nonempty text of at most {limit} characters")
    return value.strip()


def baseline_interpretation(text):
    lowered = text.lower()
    if "?" in text:
        kind = "question"
    elif any(x in lowered for x in ("maybe", "could", "should", "i can", "i will", "propose")):
        kind = "proposal"
    elif any(x in lowered for x in ("concern", "worried", "risk")):
        kind = "concern"
    elif any(x in lowered for x in ("hand over", "pass to")):
        kind = "handoff"
    else:
        kind = "statement"
    return {"kind": kind, "confirmed": False, "source": "rules-v1",
            "spans": [{"label": "contribution", "start": 0, "end": len(text), "text": text}],
            "needs_clarification": bool(re.search(r"\b(it|this|that)\b", lowered))}


class Store:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        with self.connect() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, state TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS auth(digest TEXT PRIMARY KEY, session TEXT, participant TEXT);
            """)
        Path(path).chmod(0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def mutate(self, sid, fn):
        with self.lock, self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT state FROM sessions WHERE id=?", (sid,)).fetchone()
            if not row:
                raise Problem("Session not found", 404)
            state = json.loads(row[0])
            result = fn(state, db)
            db.execute("UPDATE sessions SET state=? WHERE id=?", (json.dumps(state), sid))
            return copy.deepcopy(result)


class Controller:
    def __init__(self, store, organizer_token, model=None, clock=time.time):
        if not organizer_token:
            raise ValueError("Organizer token is required")
        self.store, self.organizer_token, self.model, self.clock = store, organizer_token, model, clock

    def organizer(self, token):
        if not secrets.compare_digest(token, self.organizer_token):
            raise Problem("Organizer authorization required", 403)

    def actor(self, sid, token):
        with self.store.connect() as db:
            row = db.execute("SELECT participant FROM auth WHERE digest=? AND session=?", (token_hash(token), sid)).fetchone()
        if not row:
            raise Problem("Session authorization required", 401)
        return row[0]

    def event(self, s, kind, actor=None, **data):
        s["version"] += 1
        e = {"id": f"evt_{s['version']:04d}", "type": kind, "at": self.clock(), "actor": actor, **data}
        s["events"].append(e)
        return e

    def create(self, token, roster):
        self.organizer(token)
        if not isinstance(roster, list) or not 1 <= len(roster) <= 12:
            raise Problem("Provide 1–12 invited participants")
        participants, invitations = {}, {}
        for p in roster:
            pid, name = required(p, "id", 80), required(p, "name", 100)
            if pid in participants or p.get("role") not in ("chair", "member"):
                raise Problem("Participant IDs must be unique and roles must be chair/member")
            invitation = secrets.token_urlsafe(32)
            participants[pid] = {"name": name, "role": p["role"], "invite_hash": token_hash(invitation)}
            invitations[pid] = invitation
        if sum(p["role"] == "chair" for p in participants.values()) != 1:
            raise Problem("Exactly one chair is required")
        sid = "session_" + uuid.uuid4().hex[:16]
        s = {"id": sid, "version": 0, "scenario_version": "cyber-absence-v1",
             "participants": participants, "events": [], "contributions": {}, "decisions": {},
             "idempotency": {}, "round": 0, "deadline": self.clock() + 300, "paused_at": None,
             "ended": False, "queue": [], "speaker": None, "speech": [],
             "released": [{"id": "opening", "text": OPENING}]}
        self.event(s, "session.created", situation=OPENING, document_refs=list(DOCUMENTS))
        with self.store.lock, self.store.connect() as db:
            db.execute("INSERT INTO sessions VALUES (?,?)", (sid, json.dumps(s)))
        return {"session_id": sid, "invitations": invitations}

    def join(self, sid, invitation):
        if not isinstance(invitation, str):
            raise Problem("Invitation required", 401)
        def apply(s, db):
            pid = next((pid for pid, p in s["participants"].items()
                        if secrets.compare_digest(p["invite_hash"], token_hash(invitation))), None)
            if not pid:
                raise Problem("Invalid invitation", 401)
            token = secrets.token_urlsafe(32)
            db.execute("INSERT INTO auth VALUES (?,?,?)", (token_hash(token), sid, pid))
            return {"participant_id": pid, "token": token}
        return self.store.mutate(sid, apply)

    def tick_state(self, s):
        if s["paused_at"] is not None or s["ended"]:
            return
        while self.clock() >= s["deadline"] and not s["ended"]:
            s["round"] += 1
            released = next_event(s["round"], s["decisions"].values())
            s["released"].append(released)
            self.event(s, "scenario.released", scenario_event_id=released["id"], text=released["text"])
            for item in s["speech"]:
                if item["status"] in ("queued", "active"):
                    item["status"] = "obsolete"
                    self.event(s, "speech.obsolete", speech_id=item["id"], delivered=False)
            s["ended"] = s["round"] >= 3
            s["deadline"] += 300

    def tick_all(self):
        with self.store.connect() as db:
            ids = [row[0] for row in db.execute("SELECT id FROM sessions")]
        for sid in ids:
            self.store.mutate(sid, lambda s, db: self.tick_state(s))

    @staticmethod
    def chair(s, pid):
        if s["participants"][pid]["role"] != "chair":
            raise Problem("Only the authenticated chair can do this", 403)

    def public(self, s):
        out = {k: copy.deepcopy(s[k]) for k in ("id", "version", "scenario_version", "round", "deadline", "paused_at", "ended", "queue", "speaker", "released", "events", "decisions", "speech")}
        out["participants"] = {pid: {k: p[k] for k in ("name", "role")} for pid, p in s["participants"].items()}
        out["documents"] = DOCUMENTS
        out["climate"] = self.climate(s)
        return out

    def state(self, sid, token):
        self.actor(sid, token)
        def apply(s, db):
            self.tick_state(s)
            return self.public(s)
        return self.store.mutate(sid, apply)

    def contribute(self, sid, token, data):
        pid = self.actor(sid, token)
        text, segment = required(data, "text", 5000), required(data, "segment_id", 120)
        if data.get("committed", True) is not True:
            return {"status": "provisional", "participant_id": pid, "text": text}
        source = data.get("source", "typed")
        if source not in ("typed", "speech"):
            raise Problem("source must be typed or speech")
        key = pid + ":" + segment
        def apply(s, db):
            self.tick_state(s)
            if key in s["contributions"]:
                old = s["contributions"][key]
                if old["text"] != text or old["source"] != source:
                    raise Problem("Segment ID already used with different content", 409)
                return {**old, "duplicate": True}
            if s["ended"]:
                raise Problem("Exercise has ended", 409)
            e = self.event(s, "contribution.committed", pid, text=text, source=source, segment_id=segment)
            record = {"event_id": e["id"], "participant_id": pid, "text": text, "source": source,
                      "interpretation": baseline_interpretation(text)}
            s["contributions"][key] = record
            self.event(s, "interpretation.proposed", pid, contribution_id=e["id"], interpretation=record["interpretation"])
            return record
        record = self.store.mutate(sid, apply)
        # Model calls run outside the state transaction; timers and queues keep moving.
        if self.model and not record.get("duplicate"):
            try:
                proposed = self.model.extract(text)
                if proposed["kind"] not in ("question", "proposal", "concern", "handoff", "statement"):
                    raise ValueError("Unknown interpretation kind")
                spans = proposed.get("spans", [])
                if not all(isinstance(x.get("start"), int) and isinstance(x.get("end"), int)
                           and 0 <= x["start"] < x["end"] <= len(text)
                           and text[x["start"]:x["end"]] == x.get("text") for x in spans):
                    raise ValueError("Unsupported evidence span")
                interpreted = {"kind": record["interpretation"]["kind"], "model_kind": proposed["kind"],
                               "classification_disagreement": proposed["kind"] != record["interpretation"]["kind"],
                               "spans": spans, "confirmed": False,
                               "source": "local-extractor", "needs_clarification": record["interpretation"]["needs_clarification"]}
                def enrich(s, db):
                    s["contributions"][key]["interpretation"] = interpreted
                    self.event(s, "interpretation.proposed", pid, contribution_id=record["event_id"], interpretation=interpreted)
                    return s["contributions"][key]
                record = self.store.mutate(sid, enrich)
            except Exception:
                record["model_fallback"] = True
        # No automatic AI reply or confirmation, including for ordinary questions.
        return record

    def propose(self, sid, token, data):
        pid = self.actor(sid, token)
        action = required(data, "action")
        key = required(data, "request_id", 120)
        kind = data.get("action_kind", "other")
        if kind not in ("contact_it", "contact_insurer", "publish_update", "other"):
            raise Problem("Unknown action_kind")
        def apply(s, db):
            self.tick_state(s)
            idem = pid + ":proposal:" + key
            fingerprint = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
            if idem in s["idempotency"]:
                old = s["idempotency"][idem]
                if old["fingerprint"] != fingerprint:
                    raise Problem("Request ID conflict", 409)
                return s["decisions"][old["id"]]
            if s["ended"]:
                raise Problem("Exercise has ended", 409)
            owner = data.get("owner")
            if owner and owner not in s["participants"]:
                raise Problem("Owner must be a session participant")
            refs = data.get("evidence", [])
            valid = {c["event_id"] for c in s["contributions"].values()}
            if not isinstance(refs, list) or any(ref not in valid for ref in refs):
                raise Problem("Evidence must reference actual contributions")
            did = "decision_" + uuid.uuid4().hex[:12]
            d = {"id": did, "action": action, "action_kind": kind, "owner": owner,
                 "rationale": data.get("rationale", ""), "review_time": data.get("review_time", ""),
                 "evidence": refs, "proposed_by": pid, "status": "draft"}
            for field in ("rationale", "review_time"):
                if not isinstance(d[field], str) or len(d[field]) > 2000:
                    raise Problem(f"Invalid {field}")
            d["warnings"] = ["Missing " + f for f in ("owner", "rationale", "review_time", "evidence") if not d[f]]
            s["decisions"][did] = d
            s["idempotency"][idem] = {"id": did, "fingerprint": fingerprint}
            self.event(s, "decision.proposed", pid, decision_id=did, action=action)
            return d
        return self.store.mutate(sid, apply)

    def decision(self, sid, token, did, operation):
        pid = self.actor(sid, token)
        if operation not in ("confirm", "defer"):
            raise Problem("Unknown operation")
        def apply(s, db):
            self.chair(s, pid)
            self.tick_state(s)
            d = s["decisions"].get(did)
            if not d:
                raise Problem("Decision not found", 404)
            if d["status"] == "confirmed":
                if operation == "defer":
                    raise Problem("Confirmed decisions cannot be rewritten", 409)
                return d
            if s["ended"]:
                raise Problem("Exercise has ended", 409)
            if operation == "defer":
                if d["status"] != "deferred":
                    d["status"] = "deferred"
                    self.event(s, "decision.deferred", pid, decision_id=did)
                return d
            if d["warnings"]:
                raise Problem("Resolve missing fields by submitting a complete proposal: " + ", ".join(d["warnings"]), 409)
            d.update(status="confirmed", confirmed_by=pid, confirmed_at=self.clock(),
                     known_at_confirmation=copy.deepcopy(s["released"]), document_refs=list(DOCUMENTS))
            e = self.event(s, "decision.confirmed", pid, decision_id=did, action=d["action"],
                           known_fact_ids=[f["id"] for f in s["released"]], document_refs=list(DOCUMENTS))
            d["confirmation_event_id"] = e["id"]
            return d
        return self.store.mutate(sid, apply)

    def coordinate(self, sid, token, data):
        pid = self.actor(sid, token)
        operation = data.get("operation")
        def apply(s, db):
            self.tick_state(s)
            if operation == "raise":
                if pid != s["speaker"] and pid not in s["queue"]:
                    s["queue"].append(pid)
            elif operation in ("finish", "pass"):
                if s["speaker"] != pid:
                    raise Problem("Only the current speaker can finish/pass", 403)
                s["speaker"] = s["queue"].pop(0) if s["queue"] else None
            elif operation == "invite":
                self.chair(s, pid)
                target = data.get("participant_id")
                if target not in s["participants"]:
                    raise Problem("Unknown participant")
                if s["speaker"] and s["speaker"] != target and s["speaker"] not in s["queue"]:
                    s["queue"].insert(0, s["speaker"])
                s["queue"] = [p for p in s["queue"] if p != target]
                s["speaker"] = target
            elif operation == "pause":
                self.chair(s, pid)
                if s["paused_at"] is None:
                    s["paused_at"] = self.clock()
            elif operation == "resume":
                self.chair(s, pid)
                if s["paused_at"] is not None:
                    s["deadline"] += self.clock() - s["paused_at"]
                    s["paused_at"] = None
            elif operation == "resolve_question":
                self.chair(s, pid)
                ref = data.get("event_id")
                if not any(c["event_id"] == ref and c["interpretation"]["kind"] == "question" for c in s["contributions"].values()):
                    raise Problem("Unknown question")
                self.event(s, "question.resolved", pid, contribution_id=ref)
            else:
                raise Problem("Unknown coordination operation")
            self.event(s, "coordination.updated", pid, operation=operation)
            return {"speaker": s["speaker"], "queue": s["queue"], "deadline": s["deadline"], "paused_at": s["paused_at"]}
        return self.store.mutate(sid, apply)

    def talk(self, sid, token, data):
        pid = self.actor(sid, token)
        role, question = required(data, "role", 80), required(data, "text", 2000)
        request_id = required(data, "request_id", 120)
        if role not in CHARACTERS:
            raise Problem("Unknown character")
        def context(s, db):
            self.tick_state(s)
            if s["ended"]:
                raise Problem("Exercise has ended", 409)
            if role == "journalist" and s["round"] < 2:
                raise Problem("Journalist has not entered this scenario", 409)
            facts = {f["id"]: f["text"] for f in s["released"]}
            facts["role.brief"] = CHARACTERS[role]["fact"]
            facts.update({k: DOCUMENTS[k] for k in CHARACTERS[role]["documents"]})
            return {"role": role, "question": question, "facts": facts, "round": s["round"]}
        scoped = self.store.mutate(sid, context)
        fact_ids, source = ["role.brief"], "authored-fallback"
        if self.model:
            try:
                selected = self.model.select_facts(scoped)
                if not isinstance(selected, list) or not 1 <= len(selected) <= 3 or not all(isinstance(x, str) and x in scoped["facts"] for x in selected):
                    raise ValueError("Invalid model-selected facts")
                fact_ids, source = list(dict.fromkeys(selected)), "local-model-selected"
            except Exception:
                pass
        # Render only authored allowed facts; arbitrary generated prose is not published.
        reply = " ".join(scoped["facts"][fid] for fid in fact_ids)
        def publish(s, db):
            self.tick_state(s)
            if s["round"] != scoped["round"]:
                raise Problem("Scenario changed while model responded; ask again", 409)
            idem = pid + ":talk:" + request_id
            if idem in s["idempotency"]:
                old = s["idempotency"][idem]
                if old["question"] != question or old["role"] != role:
                    raise Problem("Request ID conflict", 409)
                return old["response"]
            e = self.event(s, "character.responded", pid, role=role, question=question, text=reply,
                           fact_ids=fact_ids, source=source, round=s["round"])
            speech = {"id": "speech_" + uuid.uuid4().hex[:12], "event_id": e["id"], "text": reply,
                      "role": role, "round": s["round"], "status": "queued", "delivered": False}
            s["speech"].append(speech)
            response = {"text": reply, "fact_ids": fact_ids, "source": source, "speech_id": speech["id"]}
            s["idempotency"][idem] = {"question": question, "role": role, "response": response}
            return response
        return self.store.mutate(sid, publish)

    def speech(self, sid, token, operation, speech_id=None):
        pid = self.actor(sid, token)
        def apply(s, db):
            self.chair(s, pid)
            self.tick_state(s)
            active = next((x for x in s["speech"] if x["status"] == "active"), None)
            if operation == "claim":
                if active:
                    raise Problem("Shared speaker is already occupied", 409)
                item = next((x for x in s["speech"] if x["status"] == "queued"), None)
                if item:
                    item["status"] = "active"
                    self.event(s, "speech.started", pid, speech_id=item["id"], delivered=False)
                return item
            if operation == "interrupt":
                for item in s["speech"]:
                    if item["status"] in ("active", "queued"):
                        item["status"] = "interrupted"
                        self.event(s, "speech.interrupted", pid, speech_id=item["id"], delivered=False)
                return {"interrupted": True}
            if operation not in ("complete", "fail") or not active or active["id"] != speech_id:
                raise Problem("No matching active speech", 409)
            active.update(status="delivered" if operation == "complete" else "failed", delivered=operation == "complete")
            self.event(s, "speech." + active["status"], pid, speech_id=speech_id, delivered=active["delivered"])
            return active
        return self.store.mutate(sid, apply)

    @staticmethod
    def climate(s):
        resolved = {e["contribution_id"] for e in s["events"] if e["type"] == "question.resolved"}
        questions = [c["event_id"] for c in s["contributions"].values()
                     if c["interpretation"]["kind"] == "question" and c["event_id"] not in resolved]
        counts = {pid: sum(c["participant_id"] == pid for c in s["contributions"].values()) for pid in s["participants"]}
        return {"unresolved_question_ids": questions, "captured_contributions": counts,
                "suggestions": (["Offer a recap of unresolved questions before confirming actions."] if questions else []),
                "limitations": "Uncaptured speech is unobserved. Counts do not measure competence or emotions."}

    def debrief(self, sid, token):
        self.actor(sid, token)
        def apply(s, db):
            self.tick_state(s)
            findings = []
            for d in s["decisions"].values():
                confirmed = d["status"] == "confirmed"
                refs = d["evidence"] + ([d["confirmation_event_id"]] if confirmed else [])
                findings.append({"observation": ("Confirmed with recorded owner, rationale and review time: " if confirmed else "Action remains " + d["status"] + ": ") + d["action"],
                                 "event_refs": refs, "document_refs": ["governance.1"],
                                 "known_at_confirmation": d.get("known_at_confirmation", []),
                                 "improvement": "Review the assigned action at its recorded review time." if confirmed else "Clarify and explicitly confirm or decline the proposal.",
                                 "uncertainty": "Execution outside the captured session was not observed."})
            if not findings:
                findings.append({"observation": "No actions were recorded.", "event_refs": [s["events"][0]["id"]],
                                 "document_refs": ["governance.1"], "improvement": "Record proposals and assign an owner and review time.",
                                 "uncertainty": "Uncaptured discussion cannot be evaluated."})
            return {"session_id": sid, "source": "event-rubric-v1", "findings": findings,
                    "climate": self.climate(s), "not_scored": ["emotion", "personality", "competence"],
                    "preparation": preparation()}
        return self.store.mutate(sid, apply)
