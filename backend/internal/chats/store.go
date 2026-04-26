package chats

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("not found")

type Store struct {
	db *pgxpool.Pool
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

func (s *Store) CreateChatSession(ctx context.Context, id, userID, title string) (*ChatSession, error) {
	var session ChatSession
	err := s.db.QueryRow(ctx, `
		INSERT INTO chat_sessions (id, user_id, title)
		VALUES ($1, $2, $3)
		RETURNING id, user_id, title, created_at, updated_at
	`, id, userID, title).Scan(
		&session.ID,
		&session.UserID,
		&session.Title,
		&session.CreatedAt,
		&session.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &session, nil
}

func (s *Store) ListChatSessions(ctx context.Context, userID string) ([]ChatSession, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, user_id, title, created_at, updated_at
		FROM chat_sessions
		WHERE user_id = $1
		ORDER BY updated_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sessions := make([]ChatSession, 0)
	for rows.Next() {
		var session ChatSession
		if err := rows.Scan(
			&session.ID,
			&session.UserID,
			&session.Title,
			&session.CreatedAt,
			&session.UpdatedAt,
		); err != nil {
			return nil, err
		}
		sessions = append(sessions, session)
	}
	return sessions, rows.Err()
}

func (s *Store) GetChatSession(ctx context.Context, userID, sessionID string) (*ChatSession, error) {
	var session ChatSession
	err := s.db.QueryRow(ctx, `
		SELECT id, user_id, title, created_at, updated_at
		FROM chat_sessions
		WHERE id = $1 AND user_id = $2
	`, sessionID, userID).Scan(
		&session.ID,
		&session.UserID,
		&session.Title,
		&session.CreatedAt,
		&session.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &session, nil
}

func (s *Store) UpdateChatSessionTitle(ctx context.Context, userID, sessionID, title string) (*ChatSession, error) {
	var session ChatSession
	err := s.db.QueryRow(ctx, `
		UPDATE chat_sessions
		SET title = $3, updated_at = now()
		WHERE id = $1 AND user_id = $2
		RETURNING id, user_id, title, created_at, updated_at
	`, sessionID, userID, title).Scan(
		&session.ID,
		&session.UserID,
		&session.Title,
		&session.CreatedAt,
		&session.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &session, nil
}

func (s *Store) DeleteChatSession(ctx context.Context, userID, sessionID string) error {
	tag, err := s.db.Exec(ctx, `
		DELETE FROM chat_sessions
		WHERE id = $1 AND user_id = $2
	`, sessionID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) CountFilePartURLReferences(ctx context.Context, userID string, urls []string) (map[string]int, error) {
	counts := make(map[string]int, len(urls))
	if len(urls) == 0 {
		return counts, nil
	}

	rows, err := s.db.Query(ctx, `
		SELECT part->>'url' AS url, count(*)::int
		FROM chat_messages cm
		JOIN chat_sessions cs ON cs.id = cm.session_id
		CROSS JOIN LATERAL jsonb_array_elements(cm.parts) AS part
		WHERE cs.user_id = $1
		  AND part->>'type' = 'file'
		  AND part->>'url' = ANY($2)
		GROUP BY part->>'url'
	`, userID, urls)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var url string
		var count int
		if err := rows.Scan(&url, &count); err != nil {
			return nil, err
		}
		counts[url] = count
	}
	return counts, rows.Err()
}

func (s *Store) AppendChatMessage(ctx context.Context, id, userID, sessionID, role string, parts json.RawMessage) (*ChatMessage, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var ownerID string
	err = tx.QueryRow(ctx, `
		SELECT user_id FROM chat_sessions WHERE id = $1
	`, sessionID).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && ownerID != userID) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	var message ChatMessage
	err = tx.QueryRow(ctx, `
		INSERT INTO chat_messages (id, session_id, role, parts)
		VALUES ($1, $2, $3, $4)
		RETURNING id, session_id, role, parts, created_at
	`, id, sessionID, role, []byte(parts)).Scan(
		&message.ID,
		&message.SessionID,
		&message.Role,
		&message.Parts,
		&message.CreatedAt,
	)
	if err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE chat_sessions SET updated_at = now() WHERE id = $1
	`, sessionID); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &message, nil
}

func (s *Store) ListChatMessages(ctx context.Context, userID, sessionID string) ([]ChatMessage, error) {
	if _, err := s.GetChatSession(ctx, userID, sessionID); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT id, session_id, role, parts, created_at
		FROM chat_messages
		WHERE session_id = $1
		ORDER BY created_at ASC, id ASC
	`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	messages := make([]ChatMessage, 0)
	for rows.Next() {
		var message ChatMessage
		if err := rows.Scan(
			&message.ID,
			&message.SessionID,
			&message.Role,
			&message.Parts,
			&message.CreatedAt,
		); err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	return messages, rows.Err()
}
