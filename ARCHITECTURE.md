# X-Ray System Architecture

## Overview

X-Ray is a decision observability system for debugging non-deterministic, multi-step pipelines (LLMs, ranking systems, filtering systems, classifiers). It answers **"WHY was this decision made?"**, not just "what ran". The system exposes decision-making as a Run → Step → Candidate hierarchy and supports cross-pipeline analysis without domain-specific schemas.

## Architecture

```
SDK ──HTTP──▶ API Server ──enqueue──▶ Queue ──▶ Worker ──▶ PostgreSQL
```

- SDK is fire-and-forget and never blocks pipelines
- API validates and enqueues writes asynchronously
- Workers perform DB writes with retries
- Reads query PostgreSQL directly (no queue)

## Core Abstraction

```
RUN → STEP → (optional) CANDIDATES
```

- **Run**: One execution of a pipeline
- **Step**: One decision point (typed: generate, filter, rank, select)
- **Candidate**: Optional evaluated item (sampled)

This mirrors how humans reason about pipelines and enables debugging at the decision level, not the function level.

## Data Model Rationale

**Why Run → Step → Candidate?**
- Matches mental model of real pipelines
- Makes decision flow explicit
- Enables step-level reasoning and drill-downs
- Simple to query and reason about

**Alternatives rejected:**
- Flat logs: no hierarchy, no reasoning
- Event sourcing: complex queries, unnecessary for this use case
- Graph model: overkill; most pipelines are linear

## Queryability

Each step declares a mandatory semantic type (generate, filter, rank, select). This enables cross-pipeline queries without knowing pipeline or step names.

**Example:** Find all filter steps that rejected >90% of candidates across all pipelines. This is implemented as a simple join between steps and summaries filtered by type and rejection ratio. This works across competitor discovery, categorization, listing optimization, and any future pipeline.

## Performance & Scale

The system always records step summaries (cheap, constant size). Candidate logging is opt-in and developer-controlled. This enables handling 5,000 → 30 candidate reductions without storing every intermediate item.

**Trade-offs:**
- Aggregation-first: scales cheaply, less detail by default
- Optional candidates: developer chooses verbosity per step
- Sampling strategies: top-N, bottom-N, random-N for high-volume steps

## Developer Experience

**Minimal instrumentation:** Start a run, create steps, record summaries only. Requires a few lines of code.

**Full instrumentation:** Optional candidate-level logging with sampling strategies and rich metadata per step.

**Backend unavailability:** SDK never throws exceptions. All operations are fire-and-forget. Pipelines continue unaffected even if the backend is down.

## Debugging Walkthrough

**Issue:** Phone case matched to laptop stand

1. Fetch run timeline: `GET /runs/{run_id}`
2. Query high-rejection filters: `GET /steps/query/high-rejection?threshold=0.9`
3. Inspect rejection breakdown for the problematic step
4. Sample rejected candidates to see why good matches were dropped
5. Fix category filter logic

This pinpoints where and why the decision went wrong without reproducing the issue.

## Real-World Application

In ranking and recommendation pipelines, debugging incorrect results required correlating logs across multiple services and re-running pipelines with verbose logging. X-Ray-style visibility allows inspecting which filters eliminated candidates, how ranking scores differed, and why a specific item was selected—without reproducing the issue or adding ad-hoc logs. The cross-pipeline query capability reveals systemic issues that might be missed when debugging individual pipelines in isolation.

## Failure Semantics

- SDK: Never throws, fire-and-forget HTTP
- Backend: Validates and enqueues asynchronously, never blocks
- Workers: Retry failed jobs with idempotent writes

**Observability must never break production logic.** Partial observability is acceptable.

## API Specification

This is a minimal API surface to illustrate data flow; full schemas are intentionally omitted.

**Base URL:** `http://localhost:3000`

### Runs
- `POST /runs` - Create run: `{ run_id, pipeline, input?, started_at, status? }` → `{ success: true }`
- `GET /runs?pipeline=&status=&limit=` - List runs → `Array<Run>`
- `GET /runs/:id` - Get run → `Run`
- `POST /runs/:id` - Update run: `{ ended_at?, status? }` → `{ success: true }`

### Steps
- `POST /steps` - Create step: `{ step_id, run_id, name, type, metadata? }` → `{ success: true }`
- `POST /steps/:id/summary` - Update summary: `{ input_count?, output_count?, rejection_breakdown? }` → `{ success: true }`
- `POST /steps/:id/candidates` - Add candidate: `{ candidate_id, decision, score?, reason? }` → `{ success: true }`
- `POST /steps/:id/candidates/bulk` - Add candidates: `{ candidates: Array<Candidate> }` → `{ success: true }`
- `GET /steps?run_id=&type=&name=` - List steps → `Array<Step>`
- `GET /steps/:id` - Get step with summary and candidates → `Step & { summary?, candidates? }`
- `GET /steps/query/high-rejection?threshold=0.9` - Cross-pipeline query → `Array<Step & { rejection_rate }>`

**Types:** `Run = { run_id, pipeline, input, started_at, ended_at?, status }`  
`Step = { step_id, run_id, name, type: 'filter'|'rank'|'generate'|'select', input_count?, output_count?, metadata }`  
`Candidate = { candidate_id, step_id, decision: 'accepted'|'rejected', score?, reason? }`

All POST endpoints return immediately after enqueueing; writes happen asynchronously.

## What Next?

- Configurable retention policies for candidate data
- Optional SDK acknowledgements for stronger delivery guarantees
- Authentication, multi-tenancy, and rate limiting
- UI for visualizing decision flows
- Integration with tracing systems (OpenTelemetry)
