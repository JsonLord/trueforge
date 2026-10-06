# Spynel integration boundary

- This tree owns translation between TrueForge-facing session semantics and Spynel's authenticated local application API.
- Spynel remains the authority for conversations and orchestration; do not duplicate its runtime, configuration engine, or transcript store here.
- Clients accept only the configured private Unix socket, validate its native descriptor, bound all response bodies, and never expose or log its bearer token.
- Transport failures after message admission are ambiguous. Callers must reconcile history by the stable source message ID rather than replay with a new ID.
- Tests use local Unix-socket fixtures and must not require a model provider or remote gateway.
