# Sophie NEXUS-OMEGA — Phase 19 Final Architecture

Sophie is the user-facing intelligence layer and Hermes is the execution substrate.

## Control plane
User Interface → Command API → CommandProcessor → Intent/Policy → NEXUS Orchestrator → Planner/Execution Loop → Hermes/tools → Observe → Verify → Correct → Synthesis → UI.

## Intelligence plane
Context assembly + long-term memory + research + multimodal workspace + provider routing + verification.

## Safety plane
Authentication/rate limiting, capability policy, prompt-injection detection, external-content trust classification, approval gates, protected self-upgrade, secret non-forwarding, cancellation and diagnostics.

## Evidence plane
Artifacts, large-input chunking, relevance-ranked evidence, provenance, bounded context and explicit incomplete/unsupported states.

## UI contract
The interface exposes the task pipeline, runtime state, memory count, operating mode, workspace artifacts, conversations, diagnostics and execution activity. It does not invent capabilities unavailable to the backend.

## Architectural rule
No component may claim an action occurred unless the execution/verification layer has evidence for completion. NEXUS can plan and coordinate; Hermes performs authorized external actions; Sophie owns identity, memory, permissions and presentation.
