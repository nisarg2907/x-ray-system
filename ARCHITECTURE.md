# X-Ray System Architecture

## Problem Statement

Multi-step decision systems (LLMs, ranking systems, filtering systems, classifiers) are non-deterministic and opaque. When a bad decision occurs—like matching a phone case against a laptop stand—developers need to answer: **"WHY was this decision made?"**

Traditional distributed tracing answers "what ran" but not "why this candidate won" or "which step eliminated 90% of options." X-Ray provides decision-level observability by tracking the Run → Step → Candidate hierarchy.

## Core Abstraction

The system is built around a strict three-level hierarchy:

```
RUN → STEP → (OPTIONAL) CANDIDATES
```

### Definitions

- **Run**: One execution of a pipeline (e.g., "product_matching" with query "phone case")
- **Step**: One decision point (generate, filter, rank, select)
- **Candidate**: An item being evaluated by a step (optional, sampled)

This hierarchy enables cross-pipeline queries like "show all filtering steps that dropped >90% of candidates" regardless of step names.

## Data Model

### Run
```typescript
{
  run_id: UUID,
  pipeline: string,
  input: JSONB,
  started_at: timestamp,
  ended_at: timestamp,
  status: "success" | "error"
}
```

### Step
```typescript
{
  step_id: UUID,
  run_id: UUID,
  name: string,
  type: "filter" | "rank" | "generate" | "select",
  input_count: number,
  output_count: number,
  metadata: JSONB
}
```

**Critical**: `type` is mandatory and enforced. This enables cross-pipeline queries.

### Step Summary (Aggregation-First)
```typescript
{
  step_id: UUID,
  rejected: number,
  accepted: number,
  rejection_breakdown: { [reason: string]: number }
}
```

Summaries are the default instrumentation. They answer "how many" without storing every candidate.

### Candidate (Optional/Sampled)
```typescript
{
  candidate_id: string,
  step_id: UUID,
  decision: "accepted" | "rejected",
  score?: number,
  reason?: string
}
```

Candidates are expensive. Use for sampling, debugging suspicious runs, or top-N/bottom-N analysis.

## Queryability Guarantees

### Cross-Pipeline Queries

The system supports queries that work across all pipelines:

1. **"Filtering steps dropping >90%"**
   ```sql
   SELECT * FROM steps s
   JOIN step_summaries ss ON s.step_id = ss.step_id
   WHERE s.type = 'filter'
     AND (ss.rejected::float / NULLIF(ss.rejected + ss.accepted, 0)) > 0.9
   ```

2. **"Ranking steps selecting low-score winners"**
   - Query steps with type='rank', join candidates, filter by score < threshold

3. **"Steps with high disagreement variance"**
   - Analyze rejection_breakdown JSONB for patterns

### Enforced Conventions

- `step.type` is mandatory and validated
- `input_count` and `output_count` are mandatory for summaries
- Business logic stays in `metadata` (JSONB), not schema
- This ensures queries work regardless of step names or pipeline structure

## Performance Trade-offs

### Strategy: Aggregation-First, Sampling-Optional

**Default (Cheap)**:
- Summary stats only: `input_count`, `output_count`, `rejection_breakdown`
- No candidate records stored
- Suitable for production at scale

**Optional (Expensive)**:
- Full candidate logging via `step.recordCandidate()`
- Developer controls verbosity per step
- Recommended: sample top-N, bottom-N, or random-N

### Acceptable Strategies

1. **Conditional logging**: Only log candidates on suspicious runs (e.g., rejection rate > threshold)
2. **Aggregation-only**: For large candidate sets (1000+), skip individual records
3. **Configurable limits**: Per-step limits on candidate logging

### What We Chose

- **Summary stats are always recorded** (minimal overhead)
- **Candidates are opt-in** (developer decides)
- **No automatic sampling** (explicit control)
- **No rate limiting** (SDK is fire-and-forget, backend can throttle if needed)

### What Breaks If We Chose Differently

**If we required full candidate logging**:
- Storage costs explode (millions of candidates per day)
- Write latency increases
- Queries become slower
- **Trade-off**: Better debugging, worse performance

**If we removed summaries**:
- Cross-pipeline queries become impossible
- Can't answer "which steps are aggressive filters?"
- **Trade-off**: Simpler model, less queryability

**If we made SDK blocking**:
- Pipeline latency increases
- Backend outages break pipelines
- **Trade-off**: Better reliability guarantees, worse developer experience

## Failure Handling

### SDK Side

1. **Never throws**: All SDK methods are fire-and-forget
2. **HTTP timeout**: Default 5s, configurable
3. **Silent failure**: If backend is down, pipeline continues normally
4. **Optional buffering**: In-memory buffer (disabled by default) for retry attempts

### Backend Side

1. **Idempotent writes**: POST endpoints use `ON CONFLICT` for safety
2. **Validation**: Required fields enforced, invalid types rejected
3. **Error responses**: 400 for bad requests, 500 for server errors
4. **No retries**: SDK handles retries (if buffering enabled), backend is stateless

### What Breaks If We Chose Differently

**If SDK threw on errors**:
- Pipeline crashes when backend is down
- Developer must wrap every X-Ray call in try/catch
- **Trade-off**: Better error visibility, worse reliability

**If backend retried failed SDK requests**:
- Backend becomes stateful (needs queue, workers)
- Complexity increases significantly
- **Trade-off**: Better delivery guarantees, more infrastructure

## System Components

### SDK (`sdk/`)

- **XRayClient**: Fire-and-forget HTTP client
- **Run**: Represents one pipeline execution
- **Step**: Represents one decision point
- **Minimal API**: `startRun()`, `step()`, `recordSummary()`, `recordCandidate()`, `end()`

### Backend API (`backend/`)

- **Express server**: REST API
- **PostgreSQL**: Data store with JSONB for flexibility
- **Routes**: `/runs`, `/steps`, `/steps/:id/summary`, `/steps/:id/candidates`
- **Query endpoints**: `/steps/query/high-rejection` for cross-pipeline analysis

### Database Schema

- **Normalized**: Runs, Steps, Step Summaries, Candidates
- **Indexed**: Pipeline, status, step type, rejection rate (for queries)
- **JSONB**: Metadata and input/output data for flexibility

### End-to-End Flow Diagram

```mermaid
flowchart TD
  A[User Pipeline (App / Service)] --> B[SDK (X-Ray Client)]
  B --> C[Backend API (Express)]
  C --> D[(PostgreSQL)]
  D --> E[Query Results / Debugging Tools]
```

## Debugging Walkthrough

Given a bad result: "Phone case matched against laptop stand"

1. **View full run timeline**: `GET /runs/:id` shows all steps in order
2. **Identify aggressive filter**: `GET /steps/query/high-rejection?threshold=0.5` shows steps dropping >50%
3. **See rejection breakdown**: Step summary shows `rejection_breakdown: { "category_mismatch": 4 }`
4. **Inspect sampled candidates**: `GET /steps/:id` shows accepted/rejected candidates with reasons
5. **Reason about decision**: Candidate records show why laptop stand was accepted (category filter bug)

## Performance Characteristics

These are rough, order-of-magnitude estimates to make trade-offs concrete:

- **Runs and steps**
  - 100 runs/day × 10 steps/run = 1,000 step records/day
  - Each step row (metadata + counts) ≈ 1 KB
  - **Storage**: ~1 MB/day, ~30 MB/month

- **Summaries**
  - 1 summary per step, mostly numeric fields and a small JSONB map
  - Each summary ≈ 0.5–1 KB
  - **Storage**: additional ~1 MB/day at the same scale

- **Candidates (full logging)**
  - 5,000 candidates/step × 10 steps/run = 50,000 candidates/run
  - Each candidate row (id, score, reason) ≈ 1 KB (conservative, includes JSON overhead)
  - **Storage**: ~50 MB per fully-logged run
  - 100 such runs/day → ~5 GB/day → not sustainable without sampling/retention policies

- **Candidates (sampling only)**
  - Top-10 + bottom-10 + random-20 ≈ 40 candidates/step
  - At 10 steps/run → 400 candidates/run (~400 KB/run)
  - 100 runs/day → ~40 MB/day, which is manageable

These numbers justify the design:
- **Summaries first**, candidates optional
- **Sampling helpers** instead of full logging by default

## What's Next (Future Work)

### Out of Scope (Explicitly)

- **Auth/Billing/Orgs**: Multi-tenant isolation
- **Streaming**: Real-time updates
- **UI**: Frontend dashboard (API-only for MVP)

### Potential Extensions

1. **Sampling strategies**: Built-in top-N, bottom-N, random-N helpers
2. **Alerting**: Notify on high rejection rates or suspicious patterns
3. **Analytics**: Aggregate dashboards (rejection rates over time, step performance)
4. **Trace correlation**: Link X-Ray runs to distributed traces (OpenTelemetry)
5. **Cost tracking**: Estimate storage/query costs per pipeline

### Design Decisions for Future

- **If adding UI**: Keep API-first, UI as thin client
- **If adding streaming**: Use WebSockets or SSE, keep REST for compatibility
- **If adding auth**: JWT tokens, role-based access to runs/steps
- **If scaling**: Consider read replicas, partitioning by pipeline, candidate archival

## Summary

X-Ray prioritizes **clarity, reasoning, and extensibility** over scale-at-all-costs. The aggregation-first model with optional candidate logging provides a practical balance between observability and performance. The strict Run → Step → Candidate hierarchy with mandatory `type` fields enables powerful cross-pipeline queries while keeping the data model simple.

