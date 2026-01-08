/**
 * Database initialization script.
 * Run this separately if schema auto-initialization fails.
 */

import { pool } from './connection';
import { CREATE_SCHEMA } from './schema';

async function init() {
  try {
    console.log('Initializing database schema...');
    await pool.query(CREATE_SCHEMA);
    console.log('✅ Database schema initialized successfully');
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error initializing database:', error.message);
    process.exit(1);
  }
}

init();

