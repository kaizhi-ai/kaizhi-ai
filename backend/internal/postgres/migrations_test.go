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
	if len(migrations) != 4 {
		t.Fatalf("len(migrations) = %d, want 4", len(migrations))
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

	priceMigration := migrations[2]
	if priceMigration.Version != "0003" {
		t.Fatalf("price migration version = %q, want 0003", priceMigration.Version)
	}
	if priceMigration.Name != "model_prices" {
		t.Fatalf("price migration name = %q, want model_prices", priceMigration.Name)
	}
	if !strings.Contains(priceMigration.SQL, "CREATE TABLE IF NOT EXISTS model_prices") {
		t.Fatalf("price migration SQL does not include model_prices table")
	}
	if !strings.Contains(priceMigration.SQL, "input_usd_per_million_snapshot") {
		t.Fatalf("price migration SQL does not include usage price snapshots")
	}
	for _, removedColumn := range []string{"cached_input_usd_per_million", "image_input_usd_per_million", "image_output_usd_per_million", "web_search_usd_per_1k"} {
		if strings.Contains(priceMigration.SQL, removedColumn) {
			t.Fatalf("price migration SQL should not include removed column %s", removedColumn)
		}
	}

	usageWindowMigration := migrations[3]
	if usageWindowMigration.Version != "0004" {
		t.Fatalf("usage window migration version = %q, want 0004", usageWindowMigration.Version)
	}
	if usageWindowMigration.Name != "user_usage_windows" {
		t.Fatalf("usage window migration name = %q, want user_usage_windows", usageWindowMigration.Name)
	}
	if !strings.Contains(usageWindowMigration.SQL, "usage_5h_cost_usd") ||
		!strings.Contains(usageWindowMigration.SQL, "DROP TABLE IF EXISTS usage_daily") {
		t.Fatalf("usage window migration SQL does not include user counters and usage_daily drop")
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
		"model_prices",
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

	var usageDailyExists bool
	if err := pool.QueryRow(ctx, "SELECT to_regclass('usage_daily') IS NOT NULL").Scan(&usageDailyExists); err != nil {
		t.Fatalf("query usage_daily table: %v", err)
	}
	if usageDailyExists {
		t.Fatalf("usage_daily should be dropped")
	}

	for _, column := range []string{
		"name",
		"language",
		"usage_5h_cost_usd",
		"usage_7d_cost_usd",
		"usage_5h_started_at",
		"usage_7d_started_at",
	} {
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

	for _, column := range []string{"image_input_usd_per_million", "image_output_usd_per_million", "web_search_usd_per_1k"} {
		var exists bool
		if err := pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				FROM information_schema.columns
				WHERE table_schema = current_schema()
				  AND table_name = 'model_prices'
				  AND column_name = $1
			)
		`, column).Scan(&exists); err != nil {
			t.Fatalf("query model_prices.%s column: %v", column, err)
		}
		if exists {
			t.Fatalf("model_prices.%s column should be dropped", column)
		}
	}

	for _, check := range []struct {
		table  string
		column string
	}{
		{table: "usage_events", column: "input_usd_per_million_snapshot"},
		{table: "usage_events", column: "cache_read_tokens"},
		{table: "usage_events", column: "cache_write_tokens"},
		{table: "usage_events", column: "cache_read_usd_per_million_snapshot"},
		{table: "usage_events", column: "cache_write_usd_per_million_snapshot"},
		{table: "usage_events", column: "output_usd_per_million_snapshot"},
		{table: "usage_events", column: "reasoning_usd_per_million_snapshot"},
		{table: "usage_events", column: "estimated_cost_usd"},
		{table: "usage_events", column: "price_missing"},
	} {
		var exists bool
		if err := pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				FROM information_schema.columns
				WHERE table_schema = current_schema()
				  AND table_name = $1
				  AND column_name = $2
			)
		`, check.table, check.column).Scan(&exists); err != nil {
			t.Fatalf("query %s.%s column: %v", check.table, check.column, err)
		}
		if !exists {
			t.Fatalf("%s.%s column was not created", check.table, check.column)
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
