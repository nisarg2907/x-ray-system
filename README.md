# X-Ray System

A decision X-Ray system for debugging non-deterministic, multi-step algorithmic pipelines (LLMs, ranking systems, filtering systems, classifiers).

**Answer "WHY was this decision made?" not just "what ran".**

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm (install with `npm install -g pnpm`)
- Docker (recommended) OR PostgreSQL 12+ installed locally

### Setup

1. **Clone and install dependencies**

```bash
# Install all dependencies (pnpm will install for all workspaces)
pnpm install
```

2. **Set up PostgreSQL database**

**Option A: Using Docker (Recommended)**
```bash
# Start PostgreSQL in Docker
docker-compose up -d
```

**Option B: Local PostgreSQL**
```bash
# Create database
createdb xray

# Or using psql
psql -U postgres -c "CREATE DATABASE xray;"
```

3. **Configure backend**

```bash
cd backend
cp .env.example .env
# Edit .env with your database credentials
```

4. **Start backend server**

```bash
cd backend
pnpm run build
pnpm start
# Server runs on http://localhost:3000
```

5. **Run demo pipeline**

```bash
cd demo
pnpm run build
pnpm start
```

The demo shows a product matching pipeline that makes a bad decision (matches phone case to laptop stand) and demonstrates how X-Ray reveals the root cause.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed system design, trade-offs, and queryability guarantees.

## SDK Usage

### Basic Instrumentation

```typescript
import { initXRay } from '@xray/sdk';

const xray = initXRay({
  apiUrl: 'http://localhost:3000',
  timeout: 5000,
  // Optional: enable lightweight buffering with a small in-memory buffer
  bufferSize: 100,
});

// Start a run
const run = xray.startRun('pipeline_name', { query: 'user input' });

// Create a step
const step = run.step('filter_candidates', {
  type: 'filter',
  metadata: { filter_type: 'category' },
});

// Record summary (required)
step.recordSummary({
  inputCount: 100,
  outputCount: 25,
  rejectionBreakdown: {
    'price_too_high': 50,
    'rating_too_low': 25,
  },
});

step.end();

// End run
run.end('success');
```

### Full Instrumentation (Optional)

```typescript
// Record individual candidates (expensive, use sparingly)
step.recordCandidate('candidate_123', {
  decision: 'rejected',
  score: 0.3,
  reason: 'Price too high',
});

step.recordCandidate('candidate_456', {
  decision: 'accepted',
  score: 0.9,
  reason: 'High relevance match',
});

// Record multiple candidates in a single HTTP call
step.recordCandidates([
  { candidateId: 'candidate_789', decision: 'accepted', score: 0.95, reason: 'Top match' },
  { candidateId: 'candidate_999', decision: 'rejected', score: 0.1, reason: 'Low relevance' },
]);

// Sampling helpers (top/bottom/random)
step.recordTopCandidates(
  scoredCandidates.map((c) => ({ id: c.id, score: c.score, reason: c.reason })),
  5,
);

step.recordBottomCandidates(
  scoredCandidates.map((c) => ({ id: c.id, score: c.score, reason: c.reason })),
  5,
);

step.recordRandomSample(
  candidates.map((c) => ({ id: c.id })),
  10,
);
```

### Step Types

- `filter`: Eliminates candidates (e.g., price filter, category filter)
- `rank`: Orders candidates by score
- `generate`: Creates candidates (e.g., LLM generation, search retrieval)
- `select`: Chooses final output (e.g., top-1 selection)

## API Endpoints

### Runs

- `POST /runs` - Create a new run
- `GET /runs` - List runs (supports `?pipeline=name&status=success&limit=10`)
- `GET /runs/:id` - Get specific run with all steps
- `POST /runs/:id` - Update run (end run)

### Steps

- `POST /steps` - Create a new step
- `POST /steps/:id/summary` - Update step summary
- `POST /steps/:id/candidates` - Add candidate record
- `GET /steps` - List steps (supports `?run_id=uuid&type=filter&name=step_name`)
- `GET /steps/:id` - Get step with summary and candidates
- `GET /steps/query/high-rejection` - Query filtering steps with high rejection rates (`?threshold=0.9`)

### Example Queries

**Find all filtering steps that dropped >90% of candidates:**
```bash
curl "http://localhost:3000/steps/query/high-rejection?threshold=0.9"
```

**Get full run timeline:**
```bash
curl "http://localhost:3000/runs/{run_id}"
```

**List all steps for a run:**
```bash
curl "http://localhost:3000/steps?run_id={run_id}"
```

## Project Structure

```
x-ray-system/
├── sdk/              # X-Ray SDK (TypeScript)
│   ├── src/
│   │   ├── index.ts  # Main entry point
│   │   ├── run.ts    # Run class
│   │   ├── step.ts   # Step class
│   │   └── client.ts # HTTP client
│   └── package.json
├── backend/          # Backend API (Express + PostgreSQL)
│   ├── src/
│   │   ├── index.ts           # Server entry
│   │   ├── routes/            # API routes
│   │   ├── models/            # Data access layer
│   │   └── db/                # Database schema
│   └── package.json
├── demo/             # Demo pipeline
│   └── src/index.ts
├── ARCHITECTURE.md   # System design document
└── README.md         # This file
```

## Development

### Building

```bash
# Build all packages
pnpm build:all

# Or build individually
cd sdk && pnpm run build
cd backend && pnpm run build
cd demo && pnpm run build
```

### Running in Development

```bash
# Backend (with ts-node)
cd backend
pnpm run dev

# Demo (with ts-node)
cd demo
pnpm run dev
```

## Design Principles

1. **Never blocks the pipeline**: SDK is fire-and-forget, never throws
2. **Developer controls verbosity**: Summary stats are default, candidates are optional
3. **Cross-pipeline queries**: `step.type` is mandatory, enables queries across all pipelines
4. **Aggregation-first**: Summaries answer "how many" without storing every candidate
5. **Explicit trade-offs**: Performance vs. observability is a conscious choice

## Example: Debugging a Bad Decision

**Problem**: Product matching system returns laptop stand for query "phone case"

**Debugging steps**:

1. Get run details: `GET /runs/{run_id}`
2. Query high-rejection steps: `GET /steps/query/high-rejection?threshold=0.5`
3. Inspect filter step: `GET /steps/{step_id}` shows rejection breakdown
4. Review candidates: See why laptop stand was accepted (category filter bug)
5. Fix: Update filter logic to properly match categories

## License

MIT

