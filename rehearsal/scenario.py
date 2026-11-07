"""Authored fictional scenario. Future facts never enter model requests."""

DOCUMENTS = {
    "governance.1": "Only the exercise chair can confirm board actions. Proposals and silence are not approval.",
    "incident.1": "Ask IT to establish the scope of the outage and preserve available evidence.",
    "communications.1": "Public updates must distinguish confirmed facts from information still being investigated.",
    "insurance.1": "The fictional policy asks the organization to retain an incident timeline and record its insurer contact.",
}
OPENING = "The fictional charity's booking system is unavailable. Staff cannot access tomorrow's appointments. The cause is unconfirmed."
CHARACTERS = {
    "facilitator": {"documents": list(DOCUMENTS), "fact": "Separate what is known from what needs checking. Draft actions need an owner, rationale and review time."},
    "it_support": {"documents": ["incident.1"], "fact": "The booking system is unavailable. No data loss or attacker identity has been confirmed."},
    "journalist": {"documents": ["communications.1"], "fact": "I am preparing a story about the service disruption. What can the organization publicly confirm?"},
}


def preparation():
    return {"organization": "Harbour Community Services (fictional)",
            "scenario_version": "cyber-absence-v1", "reviewed": True,
            "documents": DOCUMENTS, "roles": ["chair", "member"],
            "missing_information": ["Cause of outage", "Whether data was affected"],
            "assumptions": ["All documents and people in the exercise are fictional."]}


def next_event(round_number, decisions):
    if round_number == 1:
        return {"id": "executive_unreachable", "text": "The executive director cannot be reached. The board must allocate an incident contact and a review time."}
    if round_number == 2:
        contacted = any(d["status"] == "confirmed" and d["action_kind"] == "contact_it" for d in decisions)
        return {"id": "journalist_inquiry", "text": "A journalist requests an update. " + (
            "Because IT contact was confirmed, IT has supplied an initial outage timeline; the cause remains unconfirmed."
            if contacted else "No IT contact was confirmed before the inquiry; an initial technical timeline is still missing.")}
    return {"id": "exercise_ended", "text": "The 15-minute rehearsal has ended. Review the event history and confirmed actions."}
