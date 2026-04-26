package postgres

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"io/fs"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

type Migration struct {
	Version  string
	Name     string
	SQL      string
	Checksum string
}

func RunMigrations(ctx context.Context, db *pgxpool.Pool) error {
	if db == nil {
		return fmt.Errorf("postgres pool is not configured")
	}

	migrations, err := LoadMigrations()
	if err != nil {
		return err
	}
	return runMigrations(ctx, db, migrations)
}

func LoadMigrations() ([]Migration, error) {
	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return nil, fmt.Errorf("read migrations: %w", err)
	}

	migrations := make([]Migration, 0, len(entries))
	seen := make(map[string]string, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}

		version, name, err := parseMigrationFilename(entry.Name())
		if err != nil {
			return nil, err
		}
		if existing := seen[version]; existing != "" {
			return nil, fmt.Errorf("duplicate migration version %q in %s and %s", version, existing, entry.Name())
		}
		seen[version] = entry.Name()

		path := filepath.ToSlash(filepath.Join("migrations", entry.Name()))
		content, err := fs.ReadFile(migrationsFS, path)
		if err != nil {
			return nil, fmt.Errorf("read migration %s: %w", entry.Name(), err)
		}

		sum := sha256.Sum256(content)
		migrations = append(migrations, Migration{
			Version:  version,
			Name:     name,
			SQL:      string(content),
			Checksum: hex.EncodeToString(sum[:]),
		})
	}

	sort.Slice(migrations, func(i, j int) bool {
		return migrations[i].Version < migrations[j].Version
	})
	return migrations, nil
}

func parseMigrationFilename(filename string) (string, string, error) {
	base := strings.TrimSuffix(filename, ".sql")
	version, name, ok := strings.Cut(base, "_")
	if !ok || strings.TrimSpace(version) == "" || strings.TrimSpace(name) == "" {
		return "", "", fmt.Errorf("invalid migration filename %q; expected VERSION_name.sql", filename)
	}
	return version, name, nil
}

func runMigrations(ctx context.Context, db *pgxpool.Pool, migrations []Migration) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin migration transaction: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", int64(4213610301)); err != nil {
		return fmt.Errorf("lock migrations: %w", err)
	}
	if _, err := tx.Exec(ctx, schemaMigrationsSQL); err != nil {
		return fmt.Errorf("ensure schema_migrations table: %w", err)
	}

	applied, err := loadAppliedMigrations(ctx, tx)
	if err != nil {
		return err
	}

	for _, migration := range migrations {
		if strings.TrimSpace(migration.Version) == "" {
			return fmt.Errorf("migration version is required")
		}
		if appliedMigration, ok := applied[migration.Version]; ok {
			if appliedMigration.Checksum != migration.Checksum {
				return fmt.Errorf("migration %s checksum mismatch: database has %s, code has %s", migration.Version, appliedMigration.Checksum, migration.Checksum)
			}
			continue
		}

		if strings.TrimSpace(migration.SQL) == "" {
			return fmt.Errorf("migration %s is empty", migration.Version)
		}
		if _, err := tx.Exec(ctx, migration.SQL); err != nil {
			return fmt.Errorf("apply migration %s_%s: %w", migration.Version, migration.Name, err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO schema_migrations (version, name, checksum)
			VALUES ($1, $2, $3)
		`, migration.Version, migration.Name, migration.Checksum); err != nil {
			return fmt.Errorf("record migration %s: %w", migration.Version, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit migrations: %w", err)
	}
	return nil
}

type appliedMigration struct {
	Name     string
	Checksum string
}

func loadAppliedMigrations(ctx context.Context, tx pgx.Tx) (map[string]appliedMigration, error) {
	rows, err := tx.Query(ctx, `
		SELECT version, name, checksum
		FROM schema_migrations
		ORDER BY version
	`)
	if err != nil {
		return nil, fmt.Errorf("list applied migrations: %w", err)
	}
	defer rows.Close()

	applied := make(map[string]appliedMigration)
	for rows.Next() {
		var version string
		var migration appliedMigration
		if err := rows.Scan(&version, &migration.Name, &migration.Checksum); err != nil {
			return nil, fmt.Errorf("scan applied migration: %w", err)
		}
		applied[version] = migration
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate applied migrations: %w", err)
	}
	return applied, nil
}

const schemaMigrationsSQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
	version TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	checksum TEXT NOT NULL,
	applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`
