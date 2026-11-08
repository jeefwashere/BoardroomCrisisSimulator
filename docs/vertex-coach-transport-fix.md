# Vertex transport and coach acknowledgement repair

The private coach could not record a response card because the Vertex HTTPS client could not verify Google's certificate chain in the local Python environment. Its generic error hid this transport failure. Hosted fallback replies could also appear as raw JSON in the transcript.

The Vertex client now creates its own HTTPS handler with native system trust through the existing truststore dependency. If truststore cannot import, it uses Python's default secure context. Certificate and hostname verification remain enabled. Redirect refusal and injected test openers are preserved. There is no global SSL injection, platform specific certificate path, ledger reset or speech configuration change.

Coach acknowledgements extract only the acknowledgement string from a JSON object, including a fenced object. Unexpected objects, malformed JSON and nested structured values fall back to the existing safe acknowledgement. The hosted prompt now requests the same acknowledgement object as the Vertex path rather than contradicting its JSON instructions. No model response can change a quiz status through this normalization.

## Verification

1. Six new regression tests fail against the original source and pass after the fix. They cover native context selection, secure fallback, redirect refusal, injected openers and actual hosted acknowledgement processing.
2. The full backend suite runs 218 tests with three failures and five errors. The same eight failing checks reproduce in 25 original source tests for private sessions and narration. They concern pending asynchronous coaching fixtures and the existing speech output format expectation. They were not weakened or changed by this repair.
3. The real Vertex client completes a TLSv1.3 handshake with certificate and hostname verification. One bounded Gemini 3.8 Flash request returns OK in 1.255 seconds, reporting seven input tokens and one output token. The unchanged shared ledger reserves US$0.05 conservatively; this is not an invoice amount.
4. Native trust was exercised on macOS. Missing truststore fallback was exercised offline. Windows and Linux were not physically tested.
5. No complete game, physical microphone or speech provider test is claimed. The shared backend activation and current PIDs are recorded separately under ignored local runtime metadata.

Commands:

```sh
backend/.venv/bin/python -m unittest backend.tests.test_vertex_transport backend.tests.test_coach_acknowledgements -v
backend/.venv/bin/python -m unittest discover -s backend/tests -v
```

[Truststore platform support and native contexts](https://truststore.readthedocs.io/en/latest/) and [Python HTTPS handlers](https://docs.python.org/3.12/library/urllib.request.html#urllib.request.HTTPSHandler) describe the transport mechanism. [Google pricing](https://cloud.google.com/model-garden/pricing) was opened before the bounded live check.
