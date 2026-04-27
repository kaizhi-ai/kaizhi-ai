package postgres

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestLoadMigrations(t *testing.T) {
	migrations, err := LoadMigrations()
	if err != nil {
		t.Fatalf("LoadMigrations() error = %v", err)
	}
	if len(migrations) != 2 {
		t.Fatalf("len(migrations) = %d, want 2", len(migrations))
	}

	migration := migrations[0]
	if migration.Version != "0001" {
		t.Fatalf("migration.Version = %q, want 0001", migration.Version)
	}
	if migration.Name != "initial" {
		t.Fatalf("migration.Name = %q, want initial", migration.Name)
	}
	if !strings.Contains(migration.SQL, "CREATE TABLE IF NOT EXISTS users") {
		t.Fatalf("migration SQL does not include users table")
	}
	if len(migration.Checksum) != 64 {
		t.Fatalf("len(migration.Checksum) = %d, want 64", len(migration.Checksum))
	}

	profileMigration := migrations[1]
	if profileMigration.Version != "0002" {
		t.Fatalf("profile migration version = %q, want 0002", profileMigration.Version)
	}
	if profileMigration.Name != "add_user_profile" {
		t.Fatalf("profile migration name = %q, want add_user_profile", profileMigration.Name)
	}
	if !strings.Contains(profileMigration.SQL, "ADD COLUMN IF NOT EXISTS language") {
		t.Fatalf("profile migration SQL does not include language column")
	}
}

func TestEnsureSchemaRecordsInitialMigration(t *testing.T) {
	ctx := context.Background()
	pool, cleanup := openIsolatedPostgresSchema(t, ctx)
	defer cleanup()

	if err := EnsureSchema(ctx, pool); err != nil {
		t.Fatalf("EnsureSchema() error = %v", err)
	}
	if err := EnsureSchema(ctx, pool); err != nil {
		t.Fatalf("EnsureSchema() second run error = %v", err)
	}

	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM schema_migrations WHERE version = '0001'").Scan(&count); err != nil {
		t.Fatalf("query schema_migrations: %v", err)
	}
	if count != 1 {
		t.Fatalf("initial migration count = %d, want 1", count)
	}

	for _, table := range []string{
		"users",
		"api_keys",
		"usage_events",
		"usage_daily",
		"chat_sessions",
		"chat_messages",
	} {
		var exists bool
		if err := pool.QueryRow(ctx, "SELECT to_regclass($1) IS NOT NULL", table).Scan(&exists); err != nil {
			t.Fatalf("query table %s: %v", table, err)
		}
		if !exists {
			t.Fatalf("table %s was not created", table)
		}
	}

	for _, column := range []string{"name", "language"} {
		var exists bool
		if err := pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				FROM information_schema.columns
				WHERE table_schema = current_schema()
				  AND table_name = 'users'
				  AND column_name = $1
			)
		`, column).Scan(&exists); err != nil {
			t.Fatalf("query users.%s column: %v", column, err)
		}
		if !exists {
			t.Fatalf("users.%s column was not created", column)
		}
	}
}

func openIsolatedPostgresSchema(t *testing.T, ctx context.Context) (*pgxpool.Pool, func()) {
	t.Helper()

	databaseURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}

	adminPool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect postgres admin pool: %v", err)
	}

	schema := fmt.Sprintf("it_migrations_%d", time.Now().UnixNano())
	quotedSchema := pgx.Identifier{schema}.Sanitize()
	if _, err := adminPool.Exec(ctx, "CREATE SCHEMA "+quotedSchema); err != nil {
		adminPool.Close()
		t.Fatalf("create test schema: %v", err)
	}

	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		_, _ = adminPool.Exec(ctx, "DROP SCHEMA "+quotedSchema+" CASCADE")
		adminPool.Close()
		t.Fatalf("parse TEST_DATABASE_URL: %v", err)
	}
	if cfg.ConnConfig.RuntimeParams == nil {
		cfg.ConnConfig.RuntimeParams = make(map[string]string)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		_, _ = adminPool.Exec(ctx, "DROP SCHEMA "+quotedSchema+" CASCADE")
		adminPool.Close()
		t.Fatalf("connect postgres test pool: %v", err)
	}

	cleanup := func() {
		pool.Close()
		_, _ = adminPool.Exec(ctx, "DROP SCHEMA "+quotedSchema+" CASCADE")
		adminPool.Close()
	}
	return pool, cleanup
}
