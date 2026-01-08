# Quick Start Guide

This guide covers setup steps only. For detailed usage, see [README.md](./README.md).

## 1. Setup Database

### Option A: Using Docker (Recommended - Easiest)

```bash
# Start PostgreSQL in Docker
docker-compose up -d

# Verify it's running
docker-compose ps

# The database 'xray' is automatically created
```

This will start PostgreSQL on port 5432 with:
- Database: `xray`
- User: `postgres`
- Password: `postgres`
- Host: `localhost`

### Option B: Local PostgreSQL Installation

**First, make sure PostgreSQL is running:**

```bash
# macOS (Homebrew)
brew services start postgresql

# macOS (Postgres.app)
# Just open Postgres.app

# Linux (systemd)
sudo systemctl start postgresql

# Check if PostgreSQL is running
pg_isready
```

**Then create the database:**

```bash
# Create PostgreSQL database
createdb xray

# Or using psql
psql -U postgres -c "CREATE DATABASE xray;"
```

## 2. Install Dependencies

```bash
# Install all dependencies (pnpm will install for all workspaces)
pnpm install
```

## 3. Configure Backend

```bash
cd backend
cp .env.example .env
# Edit .env with your database credentials:
# DB_HOST=localhost
# DB_PORT=5432
# DB_NAME=xray
# DB_USER=postgres
# DB_PASSWORD=postgres
```

## 4. Initialize Database Schema

```bash
cd backend
pnpm run build
pnpm run init-db
```

Or the schema will auto-initialize when you start the server.

## 5. Start Backend

```bash
cd backend
pnpm start
# Server runs on http://localhost:3000
```

Verify it's working:
```bash
curl http://localhost:3000/health
```

## 6. Build SDK (for demo)

```bash
cd sdk
pnpm run build
```

## 7. Run Demo

```bash
cd demo
pnpm run build
pnpm start
```

## 8. Start Worker (Required for Queue Processing)

The backend uses BullMQ for reliable job processing. You need to run the worker in a separate terminal:

```bash
cd backend
pnpm run worker
# Or in development mode:
pnpm run dev:worker
```

The worker processes jobs from Redis queues and writes to PostgreSQL. Without the worker, jobs will be enqueued but not processed.

## Troubleshooting

**Database connection errors (ECONNREFUSED):**
- **Using Docker**: Make sure Docker is running and start PostgreSQL with `docker-compose up -d`
- **Local PostgreSQL**: Start it with `brew services start postgresql` (macOS) or `sudo systemctl start postgresql` (Linux)
- Check PostgreSQL is running: `pg_isready` or `docker-compose ps`
- Verify credentials in `backend/.env`
- Make sure the database exists: `createdb xray` (if not using Docker)

**Docker commands:**
```bash
# Start PostgreSQL
docker-compose up -d

# Stop PostgreSQL
docker-compose down

# View logs
docker-compose logs postgres

# Restart PostgreSQL
docker-compose restart postgres
```

**SDK import errors in demo:**
- Make sure SDK is built: `cd sdk && pnpm run build`
- Reinstall demo dependencies: `cd demo && rm -rf node_modules && pnpm install`

**Port already in use:**
- Change PORT in `backend/.env` or kill process on port 3000

