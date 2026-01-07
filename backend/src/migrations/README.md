# TypeORM Migrations

This directory contains TypeORM migration files that manage the database schema.

## Migration Commands

### Generate a new migration (from entity changes)
```bash
cd backend
pnpm run migration:generate src/migrations/YourMigrationName
```

### Create an empty migration file
```bash
cd backend
pnpm run migration:create src/migrations/YourMigrationName
```

### Run pending migrations
```bash
pnpm run migration:run
```

### Revert the last migration
```bash
pnpm run migration:revert
```

### Show migration status
```bash
pnpm run migration:show
```

## Migration Files

- `1700000000000-InitialSchema.ts` - Initial database schema with all tables and indexes

## How It Works

1. **On Server Startup**: Migrations run automatically via `runMigrations()` in `src/index.ts`
2. **Manual Execution**: Use `pnpm run migration:run` to run migrations manually
3. **Migration Tracking**: TypeORM tracks applied migrations in the `typeorm_migrations` table

## Creating New Migrations

When you modify entities, generate a migration:

```bash
# After changing entity files
pnpm run migration:generate src/migrations/AddNewFieldToStep
```

This will create a migration file that reflects the differences between your entities and the current database schema.

## Best Practices

- Always review generated migrations before running them
- Test migrations on a development database first
- Never edit existing migrations that have been run in production
- Use descriptive migration names that explain what they do

