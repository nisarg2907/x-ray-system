# X-Ray System Architecture

## Overview

X-Ray is a decision observability system for debugging non-deterministic, multi-step pipelines (LLMs, ranking systems, filtering systems, classifiers).
It answers **"WHY was this decision made?"**, not just "what ran".

The system exposes decision-making as a Run → Step → Candidate hierarchy and supports cross-pipeline analysis without domain-specific schemas.

## High-Level Architecture

```
SDK ──HTTP──▶ API Server ──enqueue──▶ Queue ──▶ Worker ──▶ PostgreSQL
```

**Key principles:**
- SDK is fire-and-forget and never blocks pipelines
- API validates and enqueues writes asynchronously
- Workers perform DB writes with retries
- Reads query PostgreSQL directly (no queue)

## Core Abstraction

```
RUN → STEP → (optional) CANDIDATES
```

- **Run**: One execution of a pipeline
- **Step**: One decision point (generate, filter, rank, select)
- **Candidate**: An evaluated option (sampled, optional)

This mirrors how humans reason about pipelines and enables debugging at the decision level, not the function level.

## Data Model

**Run**
```typescript
{ run_id, pipeline, input, started_at, ended_at, status }
```

**Step**
```typescript
{
  step_id,
  run_id,
  name,
  type: "generate" | "filter" | "rank" | "select",
  input_count,
  output_count,
  metadata
}
```

**Step Summary**
```typescript
{ step_id, accepted, rejected, rejection_breakdown }
```

**Candidate (optional)**
```typescript
{ candidate_id, step_id, decision, score?, reason? }
```

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

## Step Types & Queryability

Each step declares a semantic type (generate, filter, rank, select).

- Type is mandatory
- Stored as a string to allow forward-compatible extensions
- Enables queries like: **"Show all filter steps that rejected >90% of candidates"** without knowing pipeline or step names.

### Cross-Pipeline Queries (Example)

   ```sql
SELECT *
FROM steps s
JOIN step_summaries ss ON ss.step_id = s.step_id
   WHERE s.type = 'filter'
  AND ss.rejected::float / NULLIF(ss.accepted + ss.rejected, 0) > 0.9;
```

This works across:
- competitor discovery
- categorization
- listing optimization
- any future pipeline

## Performance Strategy

**Aggregation-first by default:**
- Always record step summaries (cheap, constant size)
- Candidate logging is optional and developer-controlled
- Supports sampling (top-N, bottom-N, random-N)

**Why:**
- Full candidate logging does not scale
- Summaries preserve queryability at low cost

## Failure Semantics

**SDK:**
- Never throws
- Fire-and-forget HTTP
- Backend failures do not affect pipelines

**Backend:**
- Validates structure
- Enqueues jobs asynchronously
- Does not block on database writes

**Workers:**
- Retry failed jobs
- Use idempotent DB writes (ON CONFLICT DO NOTHING)
- Partial observability is acceptable

**Observability must never break production logic.**

## Queue Design

The queue sits behind the API to decouple ingestion from persistence.

```
SDK → API → Queue → Worker → DB
```

- Improves reliability and throughput
- Absorbs traffic spikes
- Enables retries without SDK complexity

Reads bypass the queue and query PostgreSQL directly.

## Debugging Walkthrough (Example)

**Issue:** Phone case matched to laptop stand

1. Query for aggressive filters across all pipelines
2. Identify a category filter rejecting most candidates
3. Drill into the step to inspect rejection reasons
4. Inspect sampled rejected candidates
5. Fix filter logic

This pinpoints where and why the decision went wrong.

## Design Trade-offs

| Choice | Benefit | Cost |
|--------|---------|------|
| Aggregation-first | Scales cheaply | Less detail by default |
| Fire-and-forget SDK | Safe pipelines | Possible data loss |
| Async writes | Fast API | Eventual consistency |
| Semantic step types | Cross-pipeline queries | Mild developer constraint |

All trade-offs favor developer experience and system safety.

## Summary

X-Ray provides decision-level observability for non-deterministic systems by:
- Making decision points explicit
- Enabling cross-pipeline reasoning
- Balancing performance with debuggability
- Never interfering with production pipelines

The system is general-purpose, extensible, and production-safe.
