package users

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

type AdminAction int

const (
	AdminUnchanged AdminAction = iota
	AdminCreated
	AdminPasswordUpdated
	AdminRoleUpdated
	AdminUpdated
)

// EnsureAdmin makes the database state match the supplied credentials. If the
// user does not exist it is created; if it does exist its password hash is
// rewritten when the supplied password no longer matches. The env vars are the
// source of truth, so rotating ADMIN_PASSWORD and restarting takes effect.
func EnsureAdmin(ctx context.Context, store *Store, email, password string) (AdminAction, error) {
	email = NormalizeEmail(email)
	if email == "" || !strings.Contains(email, "@") {
		return AdminUnchanged, fmt.Errorf("invalid admin email")
	}
	if len(password) < 8 {
		return AdminUnchanged, fmt.Errorf("admin password must be at least 8 characters")
	}

	existing, err := store.GetUserByEmail(ctx, email)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return AdminUnchanged, err
	}

	if existing == nil {
		hash, err := HashPassword(password)
		if err != nil {
			return AdminUnchanged, err
		}
		if _, err := store.CreateUserWithRole(ctx, email, hash, RoleAdmin); err != nil {
			return AdminUnchanged, err
		}
		return AdminCreated, nil
	}

	passwordMatches := VerifyPassword(existing.PasswordHash, password)
	roleMatches := existing.Role == RoleAdmin
	if passwordMatches && roleMatches {
		return AdminUnchanged, nil
	}

	if !passwordMatches {
		hash, err := HashPassword(password)
		if err != nil {
			return AdminUnchanged, err
		}
		if err := store.UpdatePasswordHash(ctx, existing.ID, hash); err != nil {
			return AdminUnchanged, err
		}
	}
	if !roleMatches {
		if err := store.UpdateRole(ctx, existing.ID, RoleAdmin); err != nil {
			return AdminUnchanged, err
		}
	}
	if !passwordMatches && !roleMatches {
		return AdminUpdated, nil
	}
	if !passwordMatches {
		return AdminPasswordUpdated, nil
	}
	return AdminRoleUpdated, nil
}
