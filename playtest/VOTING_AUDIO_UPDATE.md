# CEO custom response voting audio

Branch: `experiment/ai-voice-playtest`. The decision stage now uses a new **23.13 second** ElevenLabs Flash v2.5 recording, [t01_ceo_voting_guide.mp3](recordings/t01_ceo_voting_guide.mp3).

> The CEO may now add a custom response alongside the three prepared choices. Review every option, then each member chooses and confirms their own vote in the app. A new option resets voting for everyone. After all votes, the CEO confirms the winner, or chooses among tied leaders. Spoken agreement does not count as a vote.

Only the CEO now sees the custom response form, and the backend rejects additions by other members. Members still vote individually. A new option resets pending voting with explicit acknowledgement when ballots already exist. The CEO confirms the winner or chooses among tied leaders, without overriding a clear winner. The existing nine participant recordings are unchanged.

One new generation reserved **322 conservative speech units** in the existing unlimited shared ledger. Prior assets and usage remain intact. Replaying the recording makes no provider request. [Generation metadata](evaluations/ceo-voting-audio.json) includes the exact caption, duration and integrity hash.

Refresh the local app at <http://127.0.0.1:8788/> and start a new test room. As CEO, end discussion and the adviser minute to reach the decision guide. With speech enabled it plays on entry; the CEO can also replay it. Each participant selects and confirms their own vote.

142 playtest Python tests, 31 existing tests and 34 Node UI tests passed, alongside the authored demo and JavaScript syntax. The [live HTTP check](evaluations/ceo-voting-http.json) verified the new MP3 bytes, rejection of non CEO custom additions, CEO addition, individual ballots and final commitment without new speech reservations. Audio codec, duration and hashes passed; all 50 prior manifest entries were preserved. The repeat generation command reused the saved asset without a paid call. Documentation links, guide copies, credential pattern scan and whitespace passed.

This update does not implement an unrestricted CEO override. Browser listening quality remains a manual check. The app remains local and the branch is not merged into main.
