/**
 * X-Ray Backend API Server
 */

import express from 'express';
import cors from 'cors';
import { pool } from './db/connection';
import { CREATE_SCHEMA } from './db/schema';
import runsRouter from './routes/runs';
import stepsRouter from './routes/steps';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', database: 'disconnected' });
  }
});

// Routes
app.use('/runs', runsRouter);
app.use('/steps', stepsRouter);

// Initialize database schema on startup
async function initializeDatabase() {
  try {
    await pool.query(CREATE_SCHEMA);
    console.log('✅ Database schema initialized');
  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.error('❌ Error initializing database:', errorMessage);
    
    // Check if it's a connection error
    if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('connect')) {
      console.error('\n💡 PostgreSQL is not running or not accessible.');
      console.error('   Please start PostgreSQL and ensure the database exists:');
      console.error('   1. Start PostgreSQL: docker-compose up -d (recommended) or brew services start postgresql');
      console.error('   2. Create database: createdb xray');
      console.error('   3. Check connection settings in backend/.env');
      console.error('\n   The server will continue but API calls will fail until PostgreSQL is available.\n');
    }
    // Don't exit - allow manual schema creation
  }
}

// Start server
async function start() {
  await initializeDatabase();

  app.listen(PORT, () => {
    console.log(`X-Ray API server running on http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

