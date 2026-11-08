# One guided Round 1 answer

X20 replaces four visible decision fields with one answer box. The prompt is **What would you do next, and why?** The guidance asks for a next action, reasons, supporting information and remaining unknowns, in a few sentences. The placeholder gives this outline:

> I would… because…
>
> I am basing this on…
>
> Before acting, I still need to check…

The member still reviews and explicitly confirms submission. Drafts stay with the selected test member while switching seats. Saved decision recordings combine their prepared content into this box. Explicit microphone transcription also fills the same box for correction before submission. Existing structured decisions remain readable as combined text.

The update uses the existing decision API so the running server and current meetings can stay in memory. The complete response is stored verbatim in the existing action field, with the other fields explicitly marked as not separately extracted. No AI parsing or new facts are introduced. The answer limit remains 1,200 characters. Existing bounded agent context rules remain in place.

Verification: 43 Node UI checks passed, including saved response loading, separate confirmation, exact answer preservation and member drafts. Ten existing Round 1 and four round Python checks passed. Static HTML contains one decision textarea with accessible guidance, and the live server serves the updated files. No paid calls, new recordings, server restart or computer use were needed.

Refresh the existing meeting page to load the new form. Copy any unsaved draft before refreshing. [The full guide](ROUNDTABLE_GUIDE.md) has the remaining round controls. Branch: `experiment/ai-voice-playtest`.
