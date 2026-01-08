# X-Ray System Architecture

## Overview

X-Ray is a decision observability system that tracks multi-step algorithmic pipelines (LLMs, ranking systems, filtering systems, classifiers) to answer **"WHY was this decision made?"** not just "what ran".

### High-Level Architecture

```
┌─────────────┐
│   SDK       │  Fire-and-forget HTTP client
│  (Client)   │
└──────┬──────┘
       │ HTTP
       ▼
┌─────────────┐
│  API Server │  Express.js - validates & enqueues jobs
│  (Express)  │
└──────┬──────┘
       │ Enqueue
       ▼
┌─────────────┐
│    Queue    │  BullMQ + Redis - job persistence
│  (BullMQ)   │
└──────┬──────┘
       │ Process
       ▼
┌─────────────┐
│   Worker    │  Separate process - executes business logic
│  (Process)  │
└──────┬──────┘
       │ Write
       ▼
┌─────────────┐
│ PostgreSQL  │  Data store - runs, steps, candidates
│  (Database) │
└─────────────┘
```

**Key Design Principles**:
1. **Non-blocking API**: Write operations enqueue jobs and return immediately
2. **Reliable processing**: Jobs are persisted in Redis and retried on failure
3. **Scalable workers**: Multiple workers can process jobs in parallel
4. **Fast reads**: Query endpoints access PostgreSQL directly (no queue)
5. **Fire-and-forget SDK**: Never blocks the pipeline, fails silently

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

### Data Model Rationale

**Why Run → Step → Candidate hierarchy?**

We considered several alternatives:

1. **Flat structure** (all data in one table):
   - **Rejected**: Can't query across steps, no hierarchy, difficult to reason about pipeline flow

2. **Event sourcing** (every action as an event):
   - **Rejected**: Over-engineered for this use case, complex to query, eventual consistency issues

3. **Graph structure** (steps can have multiple parents):
   - **Rejected**: Adds complexity without clear benefit, most pipelines are linear

4. **Run → Step → Candidate** (chosen):
   - **Why**: Matches mental model of pipelines (one run, multiple steps, optional candidates)
   - **Benefits**: Simple queries, clear hierarchy, easy to reason about
   - **Trade-off**: Assumes linear pipeline flow (acceptable for 95% of use cases)

**Why mandatory `step.type`?**

Without enforced types, cross-pipeline queries become impossible:
- Can't find "all filtering steps" if developers name them differently
- Can't aggregate "all ranking steps" across pipelines
- **Trade-off**: Slight constraint on developers (must choose from 4 types), but enables powerful queries

**Why JSONB for metadata?**

- **Flexibility**: Each pipeline has different context (keywords, filters, LLM prompts)
- **Extensibility**: New pipelines don't require schema changes
- **Queryability**: PostgreSQL JSONB supports indexing and queries
- **Alternative considered**: Separate columns for common fields
  - **Rejected**: Would require schema changes for every new pipeline type

**What breaks if we chose differently?**

- **If we removed step.type**: Cross-pipeline queries impossible, can't answer "which filters are too aggressive?"
- **If we required full candidate logging**: Storage explodes (5GB/day at scale), write latency increases
- **If we made SDK blocking**: Pipeline crashes when backend is down, poor developer experience

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
2. **Validation**: Required fields enforced at API level before enqueueing
3. **Job queuing**: Write operations enqueue jobs to BullMQ (non-blocking)
4. **Automatic retries**: BullMQ retries failed jobs (3 attempts with exponential backoff)
5. **Worker processing**: Separate worker process handles job execution
6. **Error handling**: Failed jobs are logged and persisted for debugging
7. **Read operations**: GET endpoints query PostgreSQL directly (synchronous, fast)

### What Breaks If We Chose Differently

**If SDK threw on errors**:
- Pipeline crashes when backend is down
- Developer must wrap every X-Ray call in try/catch
- **Trade-off**: Better error visibility, worse reliability

**If backend processed synchronously (no queue)**:
- API blocks on database writes
- Backend becomes bottleneck during high load
- Database connection pool exhaustion
- **Trade-off**: Simpler architecture, worse scalability and reliability

**Current approach (with BullMQ)**:
- API responds immediately after validation
- Jobs are persisted in Redis (survives restarts)
- Workers can scale independently
- Automatic retries on transient failures
- **Trade-off**: More infrastructure (Redis), better reliability and scalability

## Developer Experience

### Minimal Instrumentation (Getting Started)

To get *something* useful, a developer needs just **3 lines of code**:

```typescript
import { initXRay } from '@xray/sdk';

const xray = initXRay({ apiUrl: 'http://localhost:3000' });
const run = xray.startRun('my_pipeline', { input: 'data' });
```

This immediately provides:
- Run tracking (when pipeline started, ended, status)
- Basic observability (can query all runs for this pipeline)

**Next step** (add one more line per step):
```typescript
const step = run.step('filter_candidates', { type: 'filter' });
step.recordSummary({ inputCount: 100, outputCount: 25 });
step.end();
```

Now you can:
- See which steps ran in each pipeline execution
- Identify steps with high rejection rates
- Query across all pipelines for problematic steps

**Total integration**: ~5 lines of code for basic observability.

### Full Instrumentation (Complete Visibility)

For full debugging capability, add candidate-level tracking:

```typescript
// Start run
const run = xray.startRun('competitor_selection', {
  product_id: 'p123',
  seller_id: 's456'
});

// Step 1: Generate keywords (generate type)
const keywordStep = run.step('generate_keywords', {
  type: 'generate',
  metadata: { llm_model: 'gpt-4', temperature: 0.7 }
});
const keywords = await generateKeywords(product);
keywordStep.recordSummary({
  inputCount: 0,
  outputCount: keywords.length
});
// Sample top keywords for debugging
keywordStep.recordTopCandidates(
  keywords.map(k => ({ id: k, score: k.relevance })),
  5
);
keywordStep.end();

// Step 2: Search candidates (generate type)
const searchStep = run.step('search_candidates', {
  type: 'generate',
  metadata: { search_api: 'amazon', max_results: 1000 }
});
const candidates = await searchProducts(keywords);
searchStep.recordSummary({
  inputCount: keywords.length,
  outputCount: candidates.length
});
searchStep.end();

// Step 3: Filter by price/rating (filter type)
const filterStep = run.step('filter_candidates', {
  type: 'filter',
  metadata: {
    price_range: [10, 100],
    min_rating: 4.0,
    min_reviews: 50
  }
});
const filtered = candidates.filter(c => 
  c.price >= 10 && c.price <= 100 && 
  c.rating >= 4.0 && c.reviews >= 50
);

// Record rejection breakdown
const rejectionBreakdown = {};
candidates.forEach(c => {
  if (!filtered.includes(c)) {
    const reason = determineRejectionReason(c);
    rejectionBreakdown[reason] = (rejectionBreakdown[reason] || 0) + 1;
  }
});

filterStep.recordSummary({
  inputCount: candidates.length,
  outputCount: filtered.length,
  rejectionBreakdown
});

// Sample rejected candidates to understand why they were filtered
filterStep.recordBottomCandidates(
  candidates.filter(c => !filtered.includes(c))
    .map(c => ({ id: c.id, score: c.relevance, reason: determineRejectionReason(c) })),
  10
);
filterStep.end();

// Step 4: Rank candidates (rank type)
const rankStep = run.step('rank_candidates', {
  type: 'rank',
  metadata: { ranking_model: 'bert-based', weights: { relevance: 0.7, price: 0.3 } }
});
const ranked = await rankCandidates(filtered);
rankStep.recordSummary({
  inputCount: filtered.length,
  outputCount: ranked.length
});
// Record top and bottom ranked for analysis
rankStep.recordTopCandidates(
  ranked.slice(0, 5).map(c => ({ id: c.id, score: c.rank_score })),
  5
);
rankStep.recordBottomCandidates(
  ranked.slice(-5).map(c => ({ id: c.id, score: c.rank_score })),
  5
);
rankStep.end();

// Step 5: Select best match (select type)
const selectStep = run.step('select_winner', {
  type: 'select',
  metadata: { selection_strategy: 'top-1' }
});
const winner = ranked[0];
selectStep.recordSummary({
  inputCount: ranked.length,
  outputCount: 1
});
selectStep.recordCandidate(winner.id, {
  decision: 'accepted',
  score: winner.rank_score,
  reason: 'Top ranked candidate'
});
selectStep.end();

// End run
run.end('success');
```

**What this provides**:
- Complete pipeline visibility (every step tracked)
- Rejection breakdowns (why candidates were filtered)
- Sampled candidates (top/bottom for analysis)
- Full debugging capability (can trace why winner was selected)

### Backend Unavailability

**What happens if the X-Ray backend is down?**

The SDK is **fire-and-forget** and **never throws**:

1. **HTTP requests fail silently**: If backend is unreachable, SDK catches the error and continues
2. **Pipeline continues normally**: Your business logic is never blocked
3. **No data loss (optional)**: If buffering is enabled, requests are queued and retried
4. **Graceful degradation**: Observability is lost, but functionality remains

**Example behavior**:
```typescript
// Backend is down
const step = run.step('filter', { type: 'filter' });
step.recordSummary({ inputCount: 100, outputCount: 25 });
// ↑ This HTTP request fails silently
// ↓ Your code continues normally
const filtered = candidates.filter(/* ... */);
// Pipeline completes successfully, just without observability
```

**Why this design?**
- **Reliability first**: Observability shouldn't break production systems
- **Developer experience**: No try/catch blocks needed, no error handling
- **Trade-off**: Lost observability during outages (acceptable - observability is secondary to functionality)

**Optional: Buffering for resilience**
```typescript
const xray = initXRay({
  apiUrl: 'http://localhost:3000',
  bufferSize: 100, // Buffer up to 100 requests
  flushInterval: 5000 // Flush every 5 seconds
});
```

With buffering enabled:
- Requests are queued in memory if backend is down
- Automatically retried when backend recovers
- **Trade-off**: Uses more memory, but provides better delivery guarantees

## System Components

### SDK (`sdk/`)

- **XRayClient**: Fire-and-forget HTTP client
- **Run**: Represents one pipeline execution
- **Step**: Represents one decision point
- **Minimal API**: `startRun()`, `step()`, `recordSummary()`, `recordCandidate()`, `end()`

### Backend API (`backend/`)

- **Express server**: REST API that enqueues jobs (non-blocking)
- **BullMQ**: Job queue system for reliable async processing
- **Redis**: Queue backend for BullMQ
- **PostgreSQL**: Data store with JSONB for flexibility
- **Routes**: `/runs`, `/steps`, `/steps/:id/summary`, `/steps/:id/candidates` (enqueue jobs)
- **Query endpoints**: `/steps/query/high-rejection` for cross-pipeline analysis (read-only, synchronous)

### Queue Architecture

The backend uses **BullMQ** with **Redis** to decouple API requests from database operations:

- **Three queues**: `runs`, `steps`, `candidates` (one per entity type)
- **Worker process**: Separate process that consumes jobs and executes business logic
- **Processors**: Business logic moved to dedicated processor functions
- **Reliability**: Automatic retries, job persistence, failure handling
- **Performance**: API responds immediately after enqueueing, worker processes asynchronously

**Queue Flow**:
```
SDK → HTTP Request → API Endpoint → Enqueue Job → Redis/BullMQ → Worker → Processor → PostgreSQL
```

**Benefits**:
- **Non-blocking API**: Endpoints return immediately after validation
- **Better reliability**: Jobs are persisted and retried on failure
- **Scalability**: Multiple workers can process jobs in parallel
- **Resilience**: Backend can handle spikes without blocking requests

### Why BullMQ Over Alternatives?

**Considered alternatives:**

1. **Synchronous writes (no queue)**: Simple but blocks API, can't handle spikes
2. **RabbitMQ**: Requires separate service, heavier infrastructure, more complex setup
3. **AWS SQS**: Cloud-dependent, vendor lock-in, additional cost
4. **Kafka**: Overkill for this use case, complex setup, high operational overhead

**Why BullMQ:**
- **Built on Redis**: Leverages existing Redis infrastructure (no new service)
- **Automatic retries**: Built-in exponential backoff (3 attempts by default)
- **Job persistence**: Jobs survive Redis restarts (with persistence enabled)
- **Easy deployment**: Single Redis instance, minimal configuration
- **TypeScript-native**: Excellent developer experience, type-safe job data
- **Lightweight**: Much simpler than Kafka/RabbitMQ for our scale
- **Good performance**: Handles ~10,000 jobs/sec (more than sufficient)

**Trade-offs:**
- **Requires Redis**: Additional dependency (but lightweight and common)
- **Limited scale**: Single Redis instance becomes bottleneck at extreme scale (~100K+ jobs/sec)
- **No built-in sharding**: Would need Redis Cluster for horizontal scaling
- **Redis persistence**: Must enable AOF/RDB for job durability (default is in-memory)

**For our use case**: BullMQ provides the best balance of reliability, simplicity, and performance. We don't need Kafka's extreme throughput, and RabbitMQ adds unnecessary complexity.

### Database Schema

- **Normalized**: Runs, Steps, Step Summaries, Candidates
- **Indexed**: Pipeline, status, step type, rejection rate (for queries)
- **JSONB**: Metadata and input/output data for flexibility

### Race Condition Handling

**Problem:** Steps might arrive before their parent run due to network timing:
```
Time 0ms: SDK sends POST /runs → network delay
Time 5ms: SDK sends POST /steps → arrives first!
Time 10ms: POST /runs finally arrives
```

Without handling, the step creation fails with a foreign key constraint violation because the run doesn't exist yet.

**Solution:** `ensureRunExists()` creates placeholder runs

```typescript
export async function ensureRunExists(runId: string, pipeline?: string) {
  const existing = await getRun(runId);
  if (existing) return;
  
  // Create placeholder run - the actual run creation might be in flight
  await pool.query(
    `INSERT INTO runs (run_id, pipeline, input, started_at, status)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (run_id) DO NOTHING`,
    [
      runId,
      pipeline || 'unknown',
      JSON.stringify({ auto_created: true }),
      new Date().toISOString(),
      'running',
    ]
  );
}
```

**Why this works:**
- **Idempotent**: Safe to call multiple times (won't create duplicates)
- **`ON CONFLICT DO NOTHING`**: Prevents duplicate key errors if run creation arrives simultaneously
- **Placeholder updated**: When real run creation arrives, it updates the placeholder with actual data
- **Foreign key satisfied**: Step creation succeeds because run exists (even if placeholder)

**Alternative considered:** Wait for run creation in step endpoint
- **Rejected**: Adds latency (polling or blocking), still needs retry logic, complex error handling
- **Current approach**: Zero latency, simple, handles all race conditions gracefully

This pattern is used for:
- `ensureRunExists()`: Called before step creation
- `ensureStepExists()`: Called before summary/candidate creation

### End-to-End Flow Diagram

```
User Pipeline → SDK → API Server → Queue (BullMQ/Redis) → Worker → Processors → PostgreSQL
     ↓                              ↓
  (business logic)           (async processing)
```

**Write Operations** (POST):
- SDK sends HTTP request → API validates and enqueues job → Returns immediately
- Worker processes job asynchronously → Executes business logic → Writes to PostgreSQL

**Read Operations** (GET):
- SDK sends HTTP request → API queries PostgreSQL directly → Returns results
- No queue needed for read operations (synchronous, fast)

## Debugging Walkthrough

Given a bad result: "Phone case matched against laptop stand"

1. **View full run timeline**: `GET /runs/:id` shows all steps in order
2. **Identify aggressive filter**: `GET /steps/query/high-rejection?threshold=0.5` shows steps dropping >50%
3. **See rejection breakdown**: Step summary shows `rejection_breakdown: { "category_mismatch": 4 }`
4. **Inspect sampled candidates**: `GET /steps/:id` shows accepted/rejected candidates with reasons
5. **Reason about decision**: Candidate records show why laptop stand was accepted (category filter bug)

## Real-World Application

### Example: E-commerce Search Ranking System

I've worked on a search ranking system that used multiple ML models to rank products. When users complained about irrelevant results (e.g., "laptop" returning phone cases), debugging was painful:

**The Problem:**
- 5 different ranking models (price, relevance, popularity, recency, personalization)
- Each model scored products independently
- Final ranking was a weighted combination
- **No visibility**: Couldn't tell which model was causing bad results

**How X-Ray Would Help:**

```typescript
// Before: Opaque ranking
const results = rankProducts(query, products);
// ↑ No idea why these products were selected

// After: Full visibility
const run = xray.startRun('product_search', { query, user_id });
const ranked = rankProducts(query, products, run);
// ↑ Can now see:
//   - Which products were considered (generate step)
//   - Which were filtered out and why (filter steps)
//   - How each model scored them (rank steps)
//   - Why the final selection was made (select step)
```

**Retrofitting Approach:**

1. **Minimal change**: Wrap existing ranking function
   ```typescript
   function rankProducts(query, products, xrayRun?) {
     const step = xrayRun?.step('rank_products', { type: 'rank' });
     // ... existing ranking logic ...
     step?.recordSummary({ inputCount: products.length, outputCount: results.length });
     return results;
   }
   ```

2. **Gradual enhancement**: Add candidate tracking for suspicious queries
   ```typescript
   if (isSuspiciousQuery(query)) {
     step.recordTopCandidates(results.slice(0, 10), 10);
   }
   ```

3. **Full instrumentation**: Track each model's contribution
   ```typescript
   const priceStep = run.step('price_model', { type: 'rank' });
   const priceScores = scoreByPrice(products);
   priceStep.recordTopCandidates(priceScores, 5);
   
   const relevanceStep = run.step('relevance_model', { type: 'rank' });
   const relevanceScores = scoreByRelevance(products, query);
   relevanceStep.recordTopCandidates(relevanceScores, 5);
   ```

**Benefits:**
- **Root cause identification**: "The price model is over-weighting expensive products"
- **A/B testing**: Compare ranking strategies side-by-side
- **User complaint debugging**: "User searched 'laptop' but got phone cases - let's see the run"

**Time saved**: Instead of hours of log analysis, debugging takes minutes by querying X-Ray data.

## Scenario Coverage

The X-Ray SDK is designed to handle all three scenarios from the assignment. Here's how each maps to our data model:

### Scenario A: Competitor Discovery

**Pipeline flow:**
1. Generate search keywords (LLM) → `type: 'generate'`
2. Retrieve candidate products → `type: 'generate'`
3. Filter by price/rating/category → `type: 'filter'`
4. Rank by relevance → `type: 'rank'`
5. Select best match → `type: 'select'`

**X-Ray instrumentation:**
```typescript
const run = xray.startRun('competitor_discovery', { product_id, seller_id });

// Step 1: Generate keywords
const keywordStep = run.step('generate_keywords', { type: 'generate' });
const keywords = await llm.generateKeywords(product);
keywordStep.recordSummary({ inputCount: 0, outputCount: keywords.length });
keywordStep.recordTopCandidates(keywords, 5); // Sample top keywords

// Step 2: Search candidates
const searchStep = run.step('search_candidates', { type: 'generate' });
const candidates = await searchAPI.search(keywords);
searchStep.recordSummary({ inputCount: keywords.length, outputCount: candidates.length });

// Step 3: Filter
const filterStep = run.step('filter_candidates', { 
  type: 'filter',
  metadata: { price_range: [10, 100], min_rating: 4.0 }
});
const filtered = applyFilters(candidates);
const rejectionBreakdown = calculateRejections(candidates, filtered);
filterStep.recordSummary({
  inputCount: candidates.length,
  outputCount: filtered.length,
  rejectionBreakdown
});
filterStep.recordBottomCandidates(rejected, 10); // Why were they rejected?

// Step 4: Rank
const rankStep = run.step('rank_candidates', { type: 'rank' });
const ranked = await rankModel.score(filtered);
rankStep.recordSummary({ inputCount: filtered.length, outputCount: ranked.length });
rankStep.recordTopCandidates(ranked.slice(0, 5), 5);

// Step 5: Select
const selectStep = run.step('select_winner', { type: 'select' });
const winner = ranked[0];
selectStep.recordSummary({ inputCount: ranked.length, outputCount: 1 });
selectStep.recordCandidate(winner.id, { decision: 'accepted', score: winner.score });
```

**Queryability**: Can find all competitor discovery runs where filter step rejected >90% using cross-pipeline query.

### Scenario B: Listing Quality Optimization

**Pipeline flow:**
1. Analyze current listing → `type: 'generate'` (extract features)
2. Extract patterns from competitors → `type: 'generate'` (retrieve top listings)
3. Identify gaps → `type: 'filter'` (find missing attributes)
4. Generate content variations → `type: 'generate'` (LLM generation)
5. Score and select best → `type: 'rank'` + `type: 'select'`

**X-Ray instrumentation:**
```typescript
const run = xray.startRun('listing_optimization', { listing_id, product_id });

// Step 1: Analyze current listing
const analyzeStep = run.step('analyze_listing', { type: 'generate' });
const features = extractFeatures(listing);
analyzeStep.recordSummary({ inputCount: 0, outputCount: features.length });

// Step 2: Extract competitor patterns
const competitorStep = run.step('extract_patterns', { type: 'generate' });
const patterns = await analyzeTopCompetitors(product);
competitorStep.recordSummary({ inputCount: 0, outputCount: patterns.length });
competitorStep.recordTopCandidates(patterns, 10); // Top patterns found

// Step 3: Identify gaps
const gapStep = run.step('identify_gaps', { type: 'filter' });
const gaps = findMissingAttributes(features, patterns);
gapStep.recordSummary({
  inputCount: patterns.length,
  outputCount: gaps.length,
  rejectionBreakdown: { 'already_present': patterns.length - gaps.length }
});

// Step 4: Generate variations
const generateStep = run.step('generate_variations', { type: 'generate' });
const variations = await llm.generateListingVariations(listing, gaps);
generateStep.recordSummary({ inputCount: gaps.length, outputCount: variations.length });

// Step 5: Score and select
const scoreStep = run.step('score_variations', { type: 'rank' });
const scored = await scoreModel.evaluate(variations);
scoreStep.recordSummary({ inputCount: variations.length, outputCount: scored.length });
scoreStep.recordTopCandidates(scored, 3);

const selectStep = run.step('select_best', { type: 'select' });
const best = scored[0];
selectStep.recordCandidate(best.id, { decision: 'accepted', score: best.score });
```

**Queryability**: Can find all listing optimization runs where gap identification found >5 missing attributes.

### Scenario C: Product Categorization

**Pipeline flow:**
1. Extract product attributes → `type: 'generate'` (parse title/description)
2. Match against category requirements → `type: 'filter'` (find matching categories)
3. Handle ambiguous cases → `type: 'rank'` (score confidence)
4. Select best-fit category → `type: 'select'`

**X-Ray instrumentation:**
```typescript
const run = xray.startRun('product_categorization', { product_id, product_data });

// Step 1: Extract attributes
const extractStep = run.step('extract_attributes', { type: 'generate' });
const attributes = parseProductAttributes(product);
extractStep.recordSummary({ inputCount: 0, outputCount: attributes.length });

// Step 2: Match categories
const matchStep = run.step('match_categories', { type: 'filter' });
const matchingCategories = findMatchingCategories(attributes, taxonomy);
const rejectionBreakdown = calculateCategoryRejections(taxonomy, matchingCategories);
matchStep.recordSummary({
  inputCount: taxonomy.length, // All possible categories
  outputCount: matchingCategories.length,
  rejectionBreakdown
});
matchStep.recordTopCandidates(matchingCategories, 5); // Top matches

// Step 3: Score confidence
const scoreStep = run.step('score_confidence', { type: 'rank' });
const scored = await confidenceModel.score(matchingCategories, attributes);
scoreStep.recordSummary({ inputCount: matchingCategories.length, outputCount: scored.length });
scoreStep.recordTopCandidates(scored, 3);

// Step 4: Select category
const selectStep = run.step('select_category', { type: 'select' });
const selected = scored[0];
selectStep.recordCandidate(selected.category_id, {
  decision: 'accepted',
  score: selected.confidence,
  reason: `Best match with ${selected.confidence} confidence`
});
```

**Queryability**: Can find all categorization runs where match step eliminated >95% of categories (indicating poor attribute extraction).

### Common Patterns Across Scenarios

All three scenarios follow the same pattern:
1. **Generate**: Create/retrieve candidates
2. **Filter**: Eliminate candidates based on criteria
3. **Rank**: Order remaining candidates
4. **Select**: Choose final output

The mandatory `step.type` enables cross-scenario queries:
- "Show all filter steps that rejected >90% of candidates" (works across all scenarios)
- "Show all rank steps where top candidate had low score" (works across all scenarios)
- "Show all select steps where winner was not in top-3 ranked" (works across all scenarios)

This demonstrates the **general-purpose** nature of the SDK - it's not tied to any specific domain.

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

## Queue Architecture Details

### Job Types

**Run Jobs**:
- `create-run`: Create a new run record
- `update-run`: Update run status and end time

**Step Jobs**:
- `create-step`: Create a new step record
- `update-step-summary`: Update step summary with rejection/acceptance counts

**Candidate Jobs**:
- `create-candidate`: Create a single candidate record
- `create-candidates-bulk`: Create multiple candidate records in one transaction

### Worker Configuration

- **Concurrency**: 10 jobs per worker (configurable)
- **Rate limiting**: 100 jobs per second per queue
- **Retry strategy**: 3 attempts with exponential backoff (2s, 4s, 8s)
- **Job retention**: Completed jobs kept for 24 hours, failed jobs for 7 days

## Deployment Guide

### Local Development

```bash
# 1. Start infrastructure
docker-compose up -d  # PostgreSQL + Redis

# 2. Start API server (Terminal 1)
cd backend
pnpm install
pnpm run build
pnpm start
# Or for development: pnpm run dev

# 3. Start worker (Terminal 2)
cd backend
pnpm run worker
# Or for development: pnpm run dev:worker

# 4. Run demo (Terminal 3)
cd demo
pnpm install
pnpm run build
pnpm start
```

### Production Deployment

**Minimum viable setup:**
- **2 API servers** (load balanced) - for redundancy
- **3 Workers** (for redundancy and throughput)
- **PostgreSQL** (with read replica for analytics queries)
- **Redis** (with AOF persistence enabled for job durability)

**Scaling considerations:**

1. **API Servers** (stateless, scale horizontally):
   - Add more instances behind load balancer
   - Each instance handles HTTP requests independently
   - No shared state (all connect to same Redis/PostgreSQL)

2. **Workers** (scale horizontally):
   - Add more worker instances to increase throughput
   - Each worker processes jobs from shared queues
   - Concurrency per worker: 10 (adjust based on database capacity)

3. **PostgreSQL** (scale vertically):
   - Write-heavy workload (all writes go to primary)
   - Read replicas for analytics queries (`/steps/query/high-rejection`)
   - Connection pool: 50-100 connections per worker instance

4. **Redis** (scale vertically, or use Cluster):
   - Single instance handles ~10,000 jobs/sec (sufficient for most cases)
   - For extreme scale (>100K jobs/sec), use Redis Cluster
   - Enable AOF persistence for job durability

**Monitoring & Alerts:**

- **Queue depth**: Alert if >10,000 pending jobs (indicates worker bottleneck)
- **Worker processing time**: Alert if p99 >5 seconds (indicates database issues)
- **API response time**: Alert if p95 >200ms (indicates API bottleneck)
- **Database connection pool**: Alert if usage >80% (scale up pool or add workers)
- **Failed jobs**: Alert if failure rate >1% (indicates systemic issues)
- **Redis memory**: Alert if >80% capacity (consider cleanup or scaling)

**High Availability:**

- **API**: Multiple instances + load balancer + health checks
- **Workers**: Multiple instances (one crash doesn't stop processing)
- **PostgreSQL**: Primary + read replica (automatic failover with connection pooling)
- **Redis**: Redis Sentinel (automatic failover) or Redis Cluster (sharding)

### Infrastructure Requirements

- **PostgreSQL**: Primary data store (version 12+)
- **Redis**: Required for BullMQ queue backend (version 6+)
- Both can run in Docker: `docker-compose up -d`
- Production: Use managed services (AWS RDS, ElastiCache) or dedicated servers

## Summary

X-Ray prioritizes **clarity, reasoning, and extensibility** over scale-at-all-costs. The aggregation-first model with optional candidate logging provides a practical balance between observability and performance. The strict Run → Step → Candidate hierarchy with mandatory `type` fields enables powerful cross-pipeline queries while keeping the data model simple.

The queue-based architecture (BullMQ + Redis) provides **reliability and scalability** without blocking the API. Write operations are asynchronous and resilient, while read operations remain fast and synchronous. This design allows the system to handle high load while maintaining low latency for API responses.

