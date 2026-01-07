/**
 * Database initialization script.
 * Run this separately if migrations fail on server startup.
 */

import 'reflect-metadata';
import { AppDataSource } from './data-source';
import { runMigrations } from './migrate';

async function init() {
  try {
    console.log('Initializing TypeORM DataSource...');
    await AppDataSource.initialize();
    console.log('✅ TypeORM DataSource initialized');

    console.log('Running migrations...');
    await runMigrations();
    
    await AppDataSource.destroy();
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error initializing database:', error.message);
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
    process.exit(1);
  }
}

init();

