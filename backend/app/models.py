"""HTTP requests and public room projections."""

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, StrictBool, StrictInt, StringConstraints, field_validator

from .rules import PRESENCE_WINDOW_SECONDS, ROOM_CAPACITY


def normalize_code(value):
    return value.strip().upper() if isinstance(value, str) else value


RoomCode = Annotated[str, BeforeValidator(normalize_code), StringConstraints(pattern=r"^[A-Z0-9]{6}$")]
RoleId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]


class TabSessionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_token: str | None = None


class TabSessionView(BaseModel):
    status: Literal["ready"] = "ready"
    session_token: str


class CreateRoom(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: UUID
    room_code: RoomCode
    display_name: str = Field(min_length=1, max_length=40)

    @field_validator("display_name", mode="before")
    @classmethod
    def clean_name(cls, value):
        if isinstance(value, str):
            value = value.strip()
            if any(not char.isprintable() for char in value):
                raise ValueError("Display names must contain printable characters")
        return value


class JoinRoom(CreateRoom):
    role_id: RoleId | None = None


class LeaveRoom(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command_id: UUID


class PlayerRole(BaseModel):
    model_config = ConfigDict(extra="forbid")
    member_id: UUID
    role_id: RoleId


class StartRoom(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command_id: UUID
    room_code: RoomCode
    scenario_id: str = Field(min_length=1, max_length=64)
    scenario_version: int = Field(gt=0, strict=True)
    timing_profile: str = Field(min_length=1, max_length=64)
    players: list[PlayerRole] = Field(min_length=1, max_length=ROOM_CAPACITY)
    ballot_source: Literal["ai", "authored"] = "ai"
    # Untimed speaking turns and no session ceiling: each turn waits for the speaker to finish.
    manual_turns: bool = False
    # Test shortcut: "assessment" opens directly at Round 3 with prerecorded Round 1 and 2 answers.
    start_at: Literal["beginning", "assessment"] = "beginning"


class View(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class SpeakerClipView(View):
    clip_id: str
    started_at: datetime
    text: str | None = None


class LeaveView(View):
    room_id: UUID
    room_version: int
    status: Literal["left", "closed"]


class MemberView(View):
    member_id: UUID
    display_name: str
    is_host: bool
    connected: bool
    role_id: str | None
    eligible_from_round: int | None
    eligible_current_round: bool


class PublicDocumentView(View):
    id: str
    text: str


class RoleView(View):
    role_id: str
    name: str


class TimingView(View):
    profile_id: str
    briefing_seconds: int
    private_rounds: bool = False
    private_session_seconds: int | None = None


class ScenarioRef(View):
    scenario_id: str
    version: int
    title: str
    content_sha256: str


class ScenarioView(ScenarioRef):
    roles: list[RoleView]
    timings: list[TimingView]


class VisibleOptionView(View):
    option_id: str
    label: str
    kind: Literal["prepared", "custom", "ai"] = "prepared"
    member_id: UUID | None = None
    description: str | None = None
    rationale: str | None = None


class CurrentNodeView(View):
    node_id: str
    title: str
    situation: str
    study_questions: list[str]
    options: list[VisibleOptionView]


FactValue = str | int | bool | None


class DecisionView(View):
    decision_id: UUID
    round_id: UUID
    round_number: int
    node_id: str
    question: str
    selected_option_id: str | None
    selected_option_label: str | None
    resolution_kind: Literal["prepared", "no_decision", "custom", "ai"]
    outcome_id: str
    text: str
    facts_before: dict[str, FactValue] = Field(validation_alias="facts_before_view")
    facts_after: dict[str, FactValue] = Field(validation_alias="facts_after_view")
    contribution_ids: list[UUID]
    resolved_at: datetime
    vote_counts: dict[str, int] = Field(validation_alias="vote_counts_view")
    selection_method: str
    ai_job_id: UUID | None = None
    ai_attempt: int | None = None
    proposer_id: UUID | None = None


class ProposalView(View):
    option_id: str
    member_id: UUID
    text: str
    contribution_id: UUID


class ResolutionView(View):
    job_id: UUID
    attempt: int
    option_id: str
    member_id: UUID
    text: str
    text_sha256: str
    selection_method: str
    status: str
    error: str | None
    processed_fragments: int
    total_fragments: int


class TurnView(View):
    member_id: UUID
    round_id: UUID
    phase_id: UUID
    reason: str
    started_at: datetime
    ended_at: datetime
    actor_id: UUID | None


class CeoChangeView(View):
    round_id: UUID
    previous_member_id: UUID
    member_id: UUID
    actor_id: UUID
    at: datetime


class NarrationCaptionView(View):
    narration_id: UUID
    phase_id: UUID
    text: str


class SubmittedDecisionView(View):
    member_id: UUID
    display_name: str
    role_name: str
    submitted: bool


class OwnDecisionView(View):
    text: str
    at: datetime


class IndividualDecisionsView(View):
    submitted: list[SubmittedDecisionView]
    # The caller's own decision only; other members' texts are never projected.
    self: OwnDecisionView | None = None


class PrivateProgressView(View):
    member_id: UUID
    display_name: str
    role_name: str
    stage: Literal["not_started", "coaching", "card", "assessment", "complete"]


class GameView(View):
    phase_id: UUID
    round_id: UUID
    round_number: int = Field(ge=1)
    started_at: datetime
    scenario: ScenarioRef
    timing_profile: str
    briefing_seconds: int
    result_seconds: int
    initial_node_id: str
    facts: dict[str, FactValue]
    public_documents: list[PublicDocumentView]
    eligible_member_ids: list[UUID]
    current_node: CurrentNodeView | None
    history: list[DecisionView]
    last_result: DecisionView | None
    ending_label: str | None
    narration: NarrationCaptionView | None
    server_time: datetime
    phase_deadline: datetime | None
    session_deadline: datetime | None
    active_speaker_id: UUID | None
    speaker_order: list[UUID]
    self_vote: str | None
    vote_counts: dict[str, int] | None
    tied_option_ids: list[str]
    allowed_actions: list[str]
    turns: list[TurnView]
    ceo_changes: list[CeoChangeView]
    ended_at: datetime | None
    feedback: dict[str, Any] | None = None
    proposals: list[ProposalView] = Field(default_factory=list)
    resolution: ResolutionView | None = None
    options_source: Literal["ai", "prepared_fallback", "authored"] | None = None
    ai_options_status: Literal["pending", "ready", "failed", "disabled"] = "disabled"
    ballot_source: Literal["ai", "authored"] = "ai"
    # "experts" when the timing profile runs the AI expert panel between speaking and voting.
    discussion_mode: Literal["open", "experts"] = "open"
    # "individual" replaces the vote with private written decisions (phase "individual_decision").
    decision_mode: Literal["vote", "individual"] = "vote"
    individual_decisions: IndividualDecisionsView | None = None
    # Human readable title for endings that have no authored outcome, for example "Individual decisions recorded".
    ending_title: str | None = None
    # True when the timing profile continues into the private_session phase (Rounds 2 and 3).
    private_rounds: bool = False
    # From the private_session phase on: each electorate member's stage, never content or scores.
    private_progress: list[PrivateProgressView] | None = None
    # Index of the active turn in speaker_order; members repeat when the discussion has several speaking rounds.
    speaker_index: int | None = None
    manual_turns: bool = False
    # The saved clip the active speaker started, so every window can play it in step.
    speaker_clip: SpeakerClipView | None = None
    # Open floor rooms: nobody holds the floor and any member may take it.
    floor_open: bool = False
    last_speaker_id: UUID | None = None
    start_at: Literal["beginning", "assessment"] = "beginning"


class RoomFields(View):
    room_id: UUID
    room_code: str
    room_version: int
    capacity: Literal[30] = ROOM_CAPACITY
    presence_window_seconds: Literal[30] = PRESENCE_WINDOW_SECONDS
    host_member_id: UUID
    self_member_id: UUID
    members: list[MemberView]


class LobbyRoomView(RoomFields):
    phase: Literal["lobby"]
    game: None = None


class StartedRoomView(RoomFields):
    phase: Literal["briefing", "reading", "speaking", "discussion", "voting", "tie_break", "resolving", "resolution_failed", "decision", "result", "individual_decision", "private_session", "ended"]
    game: GameView


RoomView = Annotated[LobbyRoomView | StartedRoomView, Field(discriminator="phase")]


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    detail: ErrorDetail


class ValidationErrorResponse(BaseModel):
    detail: list[dict[str, Any]]


class ContributionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command_id: UUID
    phase_id: UUID | None = None
    kind: Literal["answer", "chat"]
    source: Literal["typed", "speech"]
    text: str = Field(min_length=1, max_length=4000)

    @field_validator("text")
    @classmethod
    def require_text(cls, value):
        if not value.strip():
            raise ValueError("Submit final nonempty text")
        return value


class ContributionView(View):
    contribution_id: UUID
    sequence: int
    member_id: UUID
    role_id: str | None
    phase_id: UUID | None
    phase: str
    round_id: UUID | None
    round_number: int | None
    node_id: str | None
    kind: Literal["answer", "chat"]
    source: Literal["typed", "speech"]
    text: str
    at: datetime


class EvidenceMemberView(View):
    member_id: UUID
    display_name: str
    role_id: str
    eligible_from_round: int
    joined_at: datetime


class RecordingView(View):
    recording_id: UUID
    member_id: UUID
    round_id: UUID
    round_number: int
    phase_id: UUID
    status: str
    transcript: str
    reviewed_text: str | None
    error: str | None
    mime_type: str | None
    audio_available: bool
    started_at: datetime
    ended_at: datetime | None
    duration_seconds: float | None


class EvaluationEvidenceView(View):
    room_id: UUID
    scenario: ScenarioRef
    started_at: datetime
    ended_at: datetime
    ending_label: str
    members: list[EvidenceMemberView]
    public_documents: list[PublicDocumentView]
    decisions: list[DecisionView]
    contributions: list[ContributionView]
    turns: list[TurnView]
    ceo_changes: list[CeoChangeView]
    recordings: list[RecordingView] = Field(default_factory=list)
    unresolved_action: ResolutionView | None = None


class PhaseCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command_id: UUID
    phase_id: UUID


class VoteCommand(PhaseCommand):
    option_id: str = Field(min_length=1, max_length=128)


class DecisionCommand(PhaseCommand):
    text: str = Field(min_length=1, max_length=1200)

    @field_validator("text")
    @classmethod
    def require_text(cls, value):
        if not value.strip():
            raise ValueError("Write a nonempty decision")
        return value


class ClipCommand(PhaseCommand):
    clip_id: str | None = Field(default=None, min_length=1, max_length=120, pattern=r"^[A-Za-z0-9_.:-]+$")
    # The caption of an AI generated reply, so listening windows can show it while it plays.
    text: str | None = Field(default=None, min_length=1, max_length=1200)


class SkipCommand(PhaseCommand):
    reason: str = Field(min_length=1, max_length=200)

    @field_validator("reason")
    @classmethod
    def require_reason(cls, value):
        if not value.strip():
            raise ValueError("Provide a reason")
        return value


class CeoCommand(PhaseCommand):
    member_id: UUID


class ProposalCommand(PhaseCommand):
    text: str


class BeginRecording(PhaseCommand):
    round_id: UUID


class AudioBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    audio_base64: str = Field(min_length=1, max_length=13_333_336)
    mime_type: str = Field(min_length=1, max_length=80)


class ReviewBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=12000)


class MediaView(View):
    status: Literal["disabled", "pending", "ready", "failed"]
    text: str
    error: str | None = None
    audio_url: str | None = None


class DeliveryBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event: Literal["started", "completed", "failed"]


class ReplyBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command_id: UUID
    mode: Literal["turn", "private"]
    # Private answers only: the coach's current question, as shown to the member.
    question: str | None = Field(default=None, min_length=1, max_length=1200)


class ConsultBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command_id: UUID
    kind: Literal["facilitator", "it", "journalist"]
    question: str = Field(min_length=1, max_length=1000)


def _nonblank(value: str) -> str:
    if not value.strip():
        raise ValueError("Write nonempty text")
    return value


AnswerText = Annotated[str, StringConstraints(min_length=1, max_length=1200), AfterValidator(_nonblank)]
CardText = Annotated[str, StringConstraints(min_length=1, max_length=600), AfterValidator(_nonblank)]


class PrivateAnswerBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command_id: UUID
    text: AnswerText
    used_clip: StrictBool = False


class CardFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: CardText
    responsibility: CardText
    evidence: CardText
    dependencies: CardText
    fallback: CardText
    communication: CardText
    review: CardText


class PrivateCardBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command_id: UUID
    fields: CardFields


class PrivateRetryBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command_id: UUID


class PrivateChoiceBody(BaseModel):
    """A Round 3 multiple choice pick. The service checks choice_id (a to d) so it can answer 422 invalid_choice."""
    model_config = ConfigDict(extra="forbid")
    command_id: UUID
    step: Annotated[StrictInt, Field(ge=1, le=5)]
    choice_id: str = Field(min_length=1, max_length=8)
