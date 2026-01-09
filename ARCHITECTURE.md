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

## API Documentation (OpenAPI Spec)

### Base URL
```
http://localhost:3000
```

### Common Response Types

**Success Response**
```typescript
{ success: true }
```

**Error Response**
```typescript
{
  error: string;        // Error type identifier
  message?: string;     // Detailed error message (optional)
}
```

**Common HTTP Status Codes**
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error)
- `404` - Not Found
- `500` - Internal Server Error
- `503` - Service Unavailable (database unavailable)

---

### Health Check

#### `GET /health`

Check API and database health.

**Response 200: Healthy**
```typescript
{
  status: "healthy",
  database: "connected"
}
```

**Response 500: Unhealthy**
```typescript
{
  status: "unhealthy",
  database: "disconnected"
}
```

---

### Runs API

#### `POST /runs`

Create a new run (enqueues job for async processing).

**Request Body**
```typescript
{
  run_id: string;           // Required: Unique identifier for the run
  pipeline: string;         // Required: Pipeline name/identifier
  input: any;               // Optional: Pipeline input data (any JSON-serializable value)
  started_at: string;       // Required: ISO 8601 timestamp
  status?: "running" | "success" | "error";  // Optional: Defaults to "running"
}
```

**Response 201: Created**
```typescript
{ success: true }
```

**Error Responses**
- `400` - Missing required fields (`run_id`, `pipeline`, `started_at`)
- `500` - Internal server error (queue unavailable)

---

#### `GET /runs`

List runs with optional filtering.

**Query Parameters**
- `pipeline` (string, optional) - Filter by pipeline name
- `status` (string, optional) - Filter by status (`running`, `success`, `error`)
- `limit` (number, optional) - Maximum number of results

**Response 200: Success**
```typescript
Array<{
  run_id: string;
  pipeline: string;
  input: any;
  started_at: string;
  ended_at?: string;
  status: "running" | "success" | "error";
}>
```

**Error Responses**
- `500` - Internal server error
- `503` - Database unavailable

---

#### `GET /runs/:id`

Get a specific run by ID.

**Path Parameters**
- `id` (string, required) - Run identifier

**Response 200: Success**
```typescript
{
  run_id: string;
  pipeline: string;
  input: any;
  started_at: string;
  ended_at?: string;
  status: "running" | "success" | "error";
}
```

**Error Responses**
- `404` - Run not found
- `500` - Internal server error
- `503` - Database unavailable

---

#### `POST /runs/:id`

Update an existing run (typically to end it). Enqueues job for async processing.

**Path Parameters**
- `id` (string, required) - Run identifier

**Request Body**
```typescript
{
  ended_at?: string;        // Optional: ISO 8601 timestamp
  status?: "running" | "success" | "error";  // Optional: New status
}
```

**Response 200: Success**
```typescript
{ success: true }
```

**Error Responses**
- `500` - Internal server error (queue unavailable)

---

### Steps API

#### `POST /steps`

Create a new step (enqueues job for async processing).

**Request Body**
```typescript
{
  step_id: string;          // Required: Unique identifier for the step
  run_id: string;           // Required: Parent run identifier
  name: string;             // Required: Step name
  type: "filter" | "rank" | "generate" | "select";  // Required: Step type
  metadata?: any;           // Optional: Step metadata (any JSON-serializable value)
  pipeline?: string;        // Optional: Pipeline name for convenience
}
```

**Response 201: Created**
```typescript
{ success: true }
```

**Error Responses**
- `400` - Missing required fields (`step_id`, `run_id`, `name`, `type`)
- `400` - Invalid step type (must be one of: `filter`, `rank`, `generate`, `select`)
- `500` - Internal server error (queue unavailable)

---

#### `POST /steps/:id/summary`

Update step summary with aggregated statistics (enqueues job for async processing).

**Path Parameters**
- `id` (string, required) - Step identifier

**Request Body**
```typescript
{
  input_count?: number;           // Optional: Number of inputs
  output_count?: number;          // Optional: Number of outputs
  rejection_breakdown?: Record<string, number>;  // Optional: Breakdown by rejection reason
  run_id?: string;                // Optional: Run identifier for validation
}
```

**Response 200: Success**
```typescript
{ success: true }
```

**Error Responses**
- `500` - Internal server error (queue unavailable)

---

#### `POST /steps/:id/candidates`

Add a single candidate record (enqueues job for async processing).

**Path Parameters**
- `id` (string, required) - Step identifier

**Request Body**
```typescript
{
  candidate_id: string;           // Required: Unique candidate identifier
  decision: "accepted" | "rejected";  // Required: Decision outcome
  score?: number;                 // Optional: Candidate score
  reason?: string;                // Optional: Decision reason
  run_id?: string;                // Optional: Run identifier for validation
}
```

**Response 201: Created**
```typescript
{ success: true }
```

**Error Responses**
- `400` - Missing required fields (`candidate_id`, `decision`)
- `400` - Invalid decision (must be `accepted` or `rejected`)
- `500` - Internal server error (queue unavailable)

---

#### `POST /steps/:id/candidates/bulk`

Add multiple candidate records in a single call (enqueues job for async processing).

**Path Parameters**
- `id` (string, required) - Step identifier

**Request Body**
```typescript
{
  candidates: Array<{
    candidate_id: string;
    decision: "accepted" | "rejected";
    score?: number;
    reason?: string;
  }>;                              // Required: Array of candidate records
  run_id?: string;                 // Optional: Run identifier for validation
}
```

**Response 201: Created**
```typescript
{ success: true }
```

**Error Responses**
- `400` - Missing or empty `candidates` array
- `500` - Internal server error (queue unavailable)

---

#### `GET /steps`

List steps with optional filtering.

**Query Parameters**
- `run_id` (string, optional) - Filter by parent run ID
- `type` (string, optional) - Filter by step type (`filter`, `rank`, `generate`, `select`)
- `name` (string, optional) - Filter by step name

**Response 200: Success**
```typescript
Array<{
  step_id: string;
  run_id: string;
  name: string;
  type: "filter" | "rank" | "generate" | "select";
  input_count?: number;
  output_count?: number;
  metadata: any;
}>
```

**Error Responses**
- `500` - Internal server error
- `503` - Database unavailable

---

#### `GET /steps/:id`

Get a specific step with its summary and candidates.

**Path Parameters**
- `id` (string, required) - Step identifier

**Response 200: Success**
```typescript
{
  step_id: string;
  run_id: string;
  name: string;
  type: "filter" | "rank" | "generate" | "select";
  input_count?: number;
  output_count?: number;
  metadata: any;
  summary?: {
    step_id: string;
    rejected: number;
    accepted: number;
    rejection_breakdown: Record<string, number>;
  };
  candidates?: Array<{
    candidate_id: string;
    step_id: string;
    decision: "accepted" | "rejected";
    score?: number;
    reason?: string;
  }>;
}
```

**Error Responses**
- `404` - Step not found
- `500` - Internal server error
- `503` - Database unavailable

---

#### `GET /steps/query/high-rejection`

Query for filter steps with high rejection rates (cross-pipeline analysis).

**Query Parameters**
- `threshold` (number, optional) - Rejection rate threshold (default: 0.9, meaning >90%)

**Response 200: Success**
```typescript
Array<{
  step_id: string;
  run_id: string;
  name: string;
  type: "filter";
  metadata: any;
  rejected: number;
  accepted: number;
  rejection_rate: number;  // Calculated: rejected / (rejected + accepted)
}>
```

**Error Responses**
- `500` - Internal server error
- `503` - Database unavailable

---

### Error Handling Notes

**Database Connection Errors (503)**
When PostgreSQL is unavailable, endpoints that read from the database will return:
```typescript
{
  error: "Database unavailable",
  message: "PostgreSQL is not running. Please start PostgreSQL and ensure the database exists."
}
```

**Validation Errors (400)**
All validation errors return a descriptive error message indicating which required fields are missing or which values are invalid.

**Async Processing**
- Write operations (POST endpoints) return immediately after enqueueing the job
- Actual database writes happen asynchronously via workers
- Partial observability is acceptable; the system prioritizes not blocking pipelines

**Idempotency**
- All write operations use `ON CONFLICT` handling
- Duplicate requests are safe and will not create duplicates
- This enables retry logic without side effects

---

## Summary

X-Ray provides decision-level observability for non-deterministic systems by:
- Making decision points explicit
- Enabling cross-pipeline reasoning
- Balancing performance with debuggability
- Never interfering with production pipelines

The system is general-purpose, extensible, and production-safe.
