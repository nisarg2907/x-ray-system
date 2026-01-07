/**
 * Demo Pipeline: Product Matching System
 * 
 * This demonstrates a multi-step pipeline that makes a bad decision:
 * - Matches a phone case against a laptop stand
 * 
 * The X-Ray system reveals which step caused the problem.
 */

import { initXRay } from '@xray/sdk';
import fetch from 'node-fetch';

// Initialize X-Ray SDK
const apiUrl = process.env.XRAY_API_URL || 'http://localhost:3000';

const xray = initXRay({
  apiUrl,
  timeout: 5000,
  bufferSize: 100, // Enable lightweight buffering
});

// Simulated product database
interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  rating: number;
  description: string;
}

const products: Product[] = [
  { id: 'p1', name: 'iPhone 15 Pro Case', category: 'phone_accessories', price: 29.99, rating: 4.5, description: 'Protective case for iPhone 15 Pro' },
  { id: 'p2', name: 'Samsung Galaxy Case', category: 'phone_accessories', price: 24.99, rating: 4.3, description: 'Protective case for Samsung Galaxy' },
  { id: 'p3', name: 'Laptop Stand', category: 'desk_accessories', price: 49.99, rating: 4.7, description: 'Adjustable laptop stand for ergonomic setup' },
  { id: 'p4', name: 'Wireless Mouse', category: 'computer_accessories', price: 39.99, rating: 4.6, description: 'Ergonomic wireless mouse' },
  { id: 'p5', name: 'USB-C Cable', category: 'cables', price: 12.99, rating: 4.2, description: 'Fast charging USB-C cable' },
  { id: 'p6', name: 'Phone Stand', category: 'phone_accessories', price: 19.99, rating: 4.4, description: 'Adjustable phone stand' },
];

// User query
const userQuery = {
  query: 'phone case',
  user_id: 'user123',
};

async function runPipeline() {
  console.log('🚀 Starting product matching pipeline...\n');
  console.log(`Query: "${userQuery.query}"\n`);

  const run = xray.startRun('product_matching', userQuery);

  // Step 1: Generate candidates (retrieve all products)
  const generateStep = run.step('generate_candidates', {
    type: 'generate',
    metadata: { method: 'full_scan' },
  });

  let candidates = products;
  generateStep.recordSummary({
    inputCount: 0, // No input for generation
    outputCount: candidates.length,
  });
  generateStep.end();

  console.log(`Step 1: Generated ${candidates.length} candidates`);

  // Step 2: Filter by category (BUG: This filter is too aggressive)
  const filterStep = run.step('filter_by_category', {
    type: 'filter',
    metadata: { filter_type: 'category_match' },
  });

  const filteredCandidates = candidates.filter((p) => {
    // BUG: Uses partial string matching on category based on the first token of the query.
    // For query "phone case", it matches categories containing "phone", but would also
    // match unrelated categories like "laptop_accessories" for a query like "lap desk".
    const firstToken = userQuery.query.toLowerCase().split(/\s+/)[0];
    return p.category.toLowerCase().includes(firstToken);
  });

  // Record rejection breakdown
  const rejectionBreakdown: Record<string, number> = {};
  candidates.forEach((p) => {
    if (!filteredCandidates.includes(p)) {
      const reason = `category_mismatch: ${p.category}`;
      rejectionBreakdown[reason] = (rejectionBreakdown[reason] || 0) + 1;
    }
  });

  filterStep.recordSummary({
    inputCount: candidates.length,
    outputCount: filteredCandidates.length,
    rejectionBreakdown,
  });

  // Sample some candidates for debugging using bulk helper
  filterStep.recordCandidates(
    filteredCandidates.slice(0, 2).map((candidate) => ({
      candidateId: candidate.id,
      decision: 'accepted',
      reason: `Category matches: ${candidate.category}`,
    }))
  );

  filterStep.recordCandidates(
    candidates
      .filter((candidate) => !filteredCandidates.includes(candidate))
      .map((candidate) => ({
        candidateId: candidate.id,
        decision: 'rejected',
        reason: `Category mismatch: ${candidate.category}`,
      }))
  );

  filterStep.end();
  candidates = filteredCandidates;

  console.log(`Step 2: Filtered to ${candidates.length} candidates`);
  console.log(`  Rejected: ${products.length - candidates.length}`);
  console.log(`  Accepted: ${candidates.length}`);

  // Step 3: Rank by relevance score
  const rankStep = run.step('rank_by_relevance', {
    type: 'rank',
    metadata: { ranking_method: 'text_similarity' },
  });

  // Simple relevance scoring (bug: doesn't properly handle category mismatch)
  const rankedCandidates = candidates.map((p) => ({
    product: p,
    score: calculateRelevanceScore(p, userQuery.query),
  })).sort((a, b) => b.score - a.score);

  rankStep.recordSummary({
    inputCount: candidates.length,
    outputCount: rankedCandidates.length,
  });

  // Record top candidates using helper
  rankStep.recordTopCandidates(
    rankedCandidates.map((item) => ({
      id: item.product.id,
      score: item.score,
      reason: `High relevance score: ${item.score.toFixed(2)}`,
    })),
    2
  );

  rankStep.end();

  console.log(`Step 3: Ranked ${rankedCandidates.length} candidates`);

  // Step 4: Select top result
  const selectStep = run.step('select_top_result', {
    type: 'select',
    metadata: { selection_strategy: 'top_1' },
  });

  const selectedProduct = rankedCandidates[0].product;

  selectStep.recordSummary({
    inputCount: rankedCandidates.length,
    outputCount: 1,
  });

  selectStep.recordCandidate(selectedProduct.id, {
    decision: 'accepted',
    score: rankedCandidates[0].score,
    reason: `Selected as top result`,
  });

  selectStep.end();

  // End run
  run.end('success');

  console.log(`\n✅ Pipeline completed`);
  console.log(`\n📦 Selected Product: ${selectedProduct.name}`);
  console.log(`   Category: ${selectedProduct.category}`);
  console.log(`   Price: $${selectedProduct.price}`);
  console.log(`   Rating: ${selectedProduct.rating}`);
  console.log(`\n🐛 PROBLEM: This is a ${selectedProduct.category} but user searched for "phone case"!`);

  // Flush any buffered requests
  await xray.flush();

  // Demonstrate debugging flow against the API
  await debugRun(run.getRunId());
}

function calculateRelevanceScore(product: Product, query: string): number {
  // Simple scoring: name match + rating boost
  const nameMatch = product.name.toLowerCase().includes(query.toLowerCase()) ? 0.7 : 0.3;
  const ratingBoost = product.rating / 5.0 * 0.3;
  return nameMatch + ratingBoost;
}

// Run the demo
runPipeline().catch((error) => {
  console.error('Pipeline error:', error);
  process.exit(1);
});

async function debugRun(runId: string): Promise<void> {
  console.log(`\n🔍 DEBUGGING: Let's find what went wrong...\n`);

  // Step 1: Fetch run details
  console.log('Step 1: Fetching run details...');
  const runRes = await fetch(`${apiUrl}/runs/${runId}`);
  const runJson = await runRes.json();
  console.log('Run:', {
    run_id: runJson.run_id,
    pipeline: runJson.pipeline,
    status: runJson.status,
    started_at: runJson.started_at,
    ended_at: runJson.ended_at,
  });

  // Step 2: Find high-rejection steps
  console.log('\nStep 2: Finding steps that dropped many candidates (filter steps with >50% rejection)...');
  const highRejRes = await fetch(`${apiUrl}/steps/query/high-rejection?threshold=0.5`);
  const highRejSteps = await highRejRes.json();
  console.log('High rejection steps (across pipelines):', highRejSteps.map((s: any) => ({
    step_id: s.step_id,
    run_id: s.run_id,
    name: s.name,
    type: s.type,
    rejected: s.rejected,
    accepted: s.accepted,
    rejection_rate: s.rejection_rate,
  })));

  const thisRunFilterStep = highRejSteps.find((s: any) => s.run_id === runId);
  if (!thisRunFilterStep) {
    console.log('\nNo high-rejection filter step found for this run.');
    return;
  }

  // Step 3: Inspect the problematic step
  console.log('\nStep 3: Inspecting filter step in this run...');
  const stepId = thisRunFilterStep.step_id;
  const stepRes = await fetch(`${apiUrl}/steps/${stepId}`);
  const stepJson = await stepRes.json();

  console.log('Step summary:', {
    step_id: stepJson.step_id,
    name: stepJson.name,
    type: stepJson.type,
    input_count: stepJson.input_count,
    output_count: stepJson.output_count,
    rejection_breakdown: stepJson.summary?.rejection_breakdown,
  });

  console.log('\nSampled candidates:');
  console.log(
    stepJson.candidates.slice(0, 5).map((c: any) => ({
      candidate_id: c.candidate_id,
      decision: c.decision,
      score: c.score,
      reason: c.reason,
    }))
  );
}

