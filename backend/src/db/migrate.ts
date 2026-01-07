/**
 * Run TypeORM migrations programmatically.
 * Used by the server on startup and by the init-db script.
 */

import 'reflect-metadata';
import { AppDataSource } from './data-source';

export async function runMigrations(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  try {
    const pendingMigrations = await AppDataSource.showMigrations();
    
    // showMigrations returns an array of pending migration names, or empty array if none
    if (Array.isArray(pendingMigrations) && pendingMigrations.length > 0) {
      console.log(`Running ${pendingMigrations.length} pending migration(s)...`);
      await AppDataSource.runMigrations();
      console.log('✅ Migrations completed');
    } else {
      console.log('✅ Database is up to date (no pending migrations)');
    }
  } catch (error: any) {
    // If migrations table doesn't exist yet, run migrations anyway
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      console.log('Migrations table not found, running initial migrations...');
      await AppDataSource.runMigrations();
      console.log('✅ Migrations completed');
    } else {
      throw error;
    }
  }
}

export async function revertLastMigration(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  await AppDataSource.undoLastMigration();
  console.log('✅ Last migration reverted');
}

