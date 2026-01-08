/**
 * Demo Pipeline: Product Matching System
 * 
 * This demonstrates a multi-step pipeline that makes a bad decision:
 * - Matches a laptop stand when user searched for "phone case"
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
    inputCount: 0,
    outputCount: candidates.length,
  });
  generateStep.end();

  console.log(`Step 1: Generated ${candidates.length} candidates`);

  // Step 2: Filter by category (BUG: Broken category matching)
  const filterStep = run.step('filter_by_category', {
    type: 'filter',
    metadata: { filter_type: 'category_match' },
  });

  const filteredCandidates = candidates.filter((p) => {
    // BUG: The filter checks for "accessories" AND price >= 25
    // This incorrectly accepts "desk_accessories" (Laptop Stand)
    // while rejecting valid cheap phone cases
    const categoryLower = p.category.toLowerCase();
    
    if (categoryLower.includes('accessories')) {
      // BUG: Should check if it's specifically "phone_accessories"
      // but instead just checks price threshold
      return p.price >= 25;
    }
    
    return false;
  });

  // Record rejection breakdown
  const rejectionBreakdown: Record<string, number> = {};
  candidates.forEach((p) => {
    if (!filteredCandidates.includes(p)) {
      const reason = `rejected: ${p.category} ($${p.price})`;
      rejectionBreakdown[reason] = (rejectionBreakdown[reason] || 0) + 1;
    }
  });

  filterStep.recordSummary({
    inputCount: candidates.length,
    outputCount: filteredCandidates.length,
    rejectionBreakdown,
  });

  // Record all candidates with detailed reasons
  candidates.forEach((candidate) => {
    const accepted = filteredCandidates.includes(candidate);
    filterStep.recordCandidate(candidate.id, {
      decision: accepted ? 'accepted' : 'rejected',
      reason: accepted 
        ? `Accepted: ${candidate.category} with price $${candidate.price}`
        : `Rejected: ${candidate.category} with price $${candidate.price} (failed filter)`,
    });
  });

  filterStep.end();
  candidates = filteredCandidates;

  console.log(`Step 2: Filtered to ${candidates.length} candidates`);
  console.log(`  Rejected: ${products.length - candidates.length}`);
  console.log(`  Accepted: ${candidates.length}`);
  candidates.forEach(c => console.log(`    - ${c.name} (${c.category}, $${c.price})`));

  // Step 3: Rank by relevance score
  const rankStep = run.step('rank_by_relevance', {
    type: 'rank',
    metadata: { ranking_method: 'rating_boost' },
  });

  // Score heavily favors rating (this amplifies the bug)
  const rankedCandidates = candidates.map((p) => ({
    product: p,
    score: calculateRelevanceScore(p, userQuery.query),
  })).sort((a, b) => b.score - a.score);

  rankStep.recordSummary({
    inputCount: candidates.length,
    outputCount: rankedCandidates.length,
  });

  // Record all ranked candidates
  rankedCandidates.forEach((item) => {
    rankStep.recordCandidate(item.product.id, {
      decision: 'accepted',
      score: item.score,
      reason: `Ranked with score ${item.score.toFixed(2)}`,
    });
  });

  rankStep.end();

  console.log(`\nStep 3: Ranked ${rankedCandidates.length} candidates`);
  rankedCandidates.forEach((item, i) => {
    console.log(`  ${i + 1}. ${item.product.name} (score: ${item.score.toFixed(2)})`);
  });

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
  
  if (selectedProduct.category !== 'phone_accessories') {
    console.log(`\n🐛 PROBLEM: Selected "${selectedProduct.name}" (${selectedProduct.category})`);
    console.log(`   but user searched for "phone case"!`);
  } else {
    console.log(`\n✅ CORRECT: This is a phone accessory as expected.`);
  }

  // Flush any buffered requests
  await xray.flush();

  // Wait for backend to process
  await new Promise(resolve => setTimeout(resolve, 500));

  // Demonstrate debugging flow
  await debugRun(run.getRunId());
}

function calculateRelevanceScore(product: Product, query: string): number {
  // Heavy rating boost makes Laptop Stand (4.7) score higher
  const nameMatch = product.name.toLowerCase().includes(query.toLowerCase()) ? 0.3 : 0.1;
  const ratingBoost = (product.rating / 5.0) * 0.9; // Heavy weight on rating
  return nameMatch + ratingBoost;
}

// Run the demo
runPipeline().catch((error) => {
  console.error('Pipeline error:', error);
  process.exit(1);
});

async function debugRun(runId: string): Promise<void> {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🔍 DEBUGGING WORKFLOW - Finding Root Cause`);
  console.log(`${'='.repeat(70)}\n`);

  // Step 1: Fetch run details
  console.log('📋 Step 1: Fetching run details...');
  const runRes = await fetch(`${apiUrl}/runs/${runId}`);
  const runJson = await runRes.json();
  console.log('   Run ID:', runJson.run_id);
  console.log('   Pipeline:', runJson.pipeline);
  console.log('   Status:', runJson.status);
  console.log('   Duration:', 
    new Date(runJson.ended_at).getTime() - new Date(runJson.started_at).getTime(), 
    'ms');

  // Step 2: Find high-rejection steps
  console.log('\n🔎 Step 2: Querying for aggressive filter steps (>40% rejection)...');
  const highRejRes = await fetch(`${apiUrl}/steps/query/high-rejection?threshold=0.4`);
  const highRejSteps = await highRejRes.json();
  
  if (highRejSteps.length === 0) {
    console.log('   No high-rejection steps found.');
  } else {
    console.log(`   Found ${highRejSteps.length} aggressive filter step(s):`);
    highRejSteps.forEach((s: any) => {
      console.log(`   - ${s.name} (${s.type}): ${(s.rejection_rate * 100).toFixed(1)}% rejection`);
      console.log(`     Rejected: ${s.rejected}, Accepted: ${s.accepted}`);
    });
  }

  const thisRunFilterStep = highRejSteps.find((s: any) => s.run_id === runId);
  if (!thisRunFilterStep) {
    console.log('\n❌ No problematic filter step found in this run.');
    console.log('   Try lowering the threshold or check if the pipeline has filter steps.');
    return;
  }

  // Step 3: Inspect the problematic step
  console.log(`\n🐛 Step 3: Inspecting problematic step: "${thisRunFilterStep.name}"...`);
  const stepId = thisRunFilterStep.step_id;
  const stepRes = await fetch(`${apiUrl}/steps/${stepId}`);
  const stepJson = await stepRes.json();

  console.log('   Step Details:');
  console.log('   - Input count:', stepJson.input_count);
  console.log('   - Output count:', stepJson.output_count);
  console.log('   - Eliminated:', stepJson.input_count - stepJson.output_count);
  console.log('   - Rejection breakdown:');
  Object.entries(stepJson.summary?.rejection_breakdown || {}).forEach(([reason, count]) => {
    console.log(`     * ${reason}: ${count}`);
  });

  console.log('\n   Sample Candidates:');
  const samples = stepJson.candidates.slice(0, 6);
  samples.forEach((c: any) => {
    const emoji = c.decision === 'accepted' ? '✅' : '❌';
    console.log(`   ${emoji} ${c.candidate_id}: ${c.decision}`);
    console.log(`      Reason: ${c.reason}`);
  });

  console.log(`\n${'='.repeat(70)}`);
  console.log('💡 ROOT CAUSE IDENTIFIED:');
  console.log('   The category filter is checking for "accessories" + price >= $25');
  console.log('   This incorrectly accepts "desk_accessories" (Laptop Stand)');
  console.log('   while rejecting valid phone cases under $25.');
  console.log('   ');
  console.log('   FIX: Filter should check for "phone_accessories" specifically,');
  console.log('        not just any category containing "accessories".');
  console.log(`${'='.repeat(70)}\n`);
}