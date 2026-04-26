package chats

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"kaizhi/backend/internal/apikeys"
	"kaizhi/backend/internal/ids"
	"kaizhi/backend/internal/users"
)

const (
	maxTitleLength = 200
	maxPartsBytes  = 1 << 20 // 1 MiB of parts JSON per message
)

var allowedRoles = map[string]struct{}{
	"system":    {},
	"user":      {},
	"assistant": {},
	"tool":      {},
}

type Handlers struct {
	store     *Store
	users     *users.Store
	apiKeys   *apikeys.Service
	mediaRoot string
}

type HandlerOption func(*Handlers)

func WithMediaRoot(root string) HandlerOption {
	return func(h *Handlers) {
		root = strings.TrimSpace(root)
		if root != "" {
			h.mediaRoot = root
		}
	}
}

func NewHandlers(store *Store, userStore *users.Store, apiKeys *apikeys.Service, opts ...HandlerOption) *Handlers {
	h := &Handlers{
		store:     store,
		users:     userStore,
		apiKeys:   apiKeys,
		mediaRoot: filepath.Join("data", "media"),
	}
	for _, opt := range opts {
		opt(h)
	}
	return h
}

func (h *Handlers) RegisterRoutes(engine *gin.Engine) {
	engine.GET("/api/v1/chats/media/:user_id/:filename", h.serveAttachment)

	group := engine.Group("/api/v1/chats")
	group.Use(apikeys.AuthMiddleware(h.apiKeys, h.users))
	group.POST("", h.create)
	group.GET("", h.list)
	group.PATCH("/:id", h.rename)
	group.DELETE("/:id", h.delete)
	group.POST("/uploads", h.uploadAttachment)
	group.GET("/:id/messages", h.listMessages)
	group.POST("/:id/messages", h.appendMessage)
}

func (h *Handlers) create(c *gin.Context) {
	user := apikeys.CurrentUser(c)
	var req struct {
		Title string `json:"title"`
	}
	if c.Request.ContentLength != 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}
	}

	title := strings.TrimSpace(req.Title)
	if len(title) > maxTitleLength {
		c.JSON(http.StatusBadRequest, gin.H{"error": "title too long"})
		return
	}

	id, err := ids.New("chat")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate id"})
		return
	}
	session, err := h.store.CreateChatSession(c.Request.Context(), id, user.ID, title)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create chat"})
		return
	}
	c.JSON(http.StatusCreated, session)
}

func (h *Handlers) list(c *gin.Context) {
	user := apikeys.CurrentUser(c)
	sessions, err := h.store.ListChatSessions(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list chats"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"chats": sessions})
}

func (h *Handlers) rename(c *gin.Context) {
	user := apikeys.CurrentUser(c)
	var req struct {
		Title string `json:"title"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "title is required"})
		return
	}
	if len(title) > maxTitleLength {
		c.JSON(http.StatusBadRequest, gin.H{"error": "title too long"})
		return
	}
	session, err := h.store.UpdateChatSessionTitle(c.Request.Context(), user.ID, c.Param("id"), title)
	if err != nil {
		respondStoreError(c, err, "failed to update chat")
		return
	}
	c.JSON(http.StatusOK, session)
}

func (h *Handlers) delete(c *gin.Context) {
	user := apikeys.CurrentUser(c)
	chatID := c.Param("id")
	messages, err := h.store.ListChatMessages(c.Request.Context(), user.ID, chatID)
	if err != nil {
		respondStoreError(c, err, "failed to delete chat")
		return
	}
	mediaFiles := h.chatMediaFiles(user.ID, messages)

	if err := h.store.DeleteChatSession(c.Request.Context(), user.ID, chatID); err != nil {
		respondStoreError(c, err, "failed to delete chat")
		return
	}
	if err := h.deleteUnreferencedChatMediaFiles(c.Request.Context(), user.ID, mediaFiles); err != nil {
		log.Printf("chats: cleanup media for deleted chat %s: %v", chatID, err)
	}
	c.Status(http.StatusNoContent)
}

func (h *Handlers) listMessages(c *gin.Context) {
	user := apikeys.CurrentUser(c)
	messages, err := h.store.ListChatMessages(c.Request.Context(), user.ID, c.Param("id"))
	if err != nil {
		respondStoreError(c, err, "failed to list messages")
		return
	}
	c.JSON(http.StatusOK, gin.H{"messages": messages})
}

func (h *Handlers) appendMessage(c *gin.Context) {
	user := apikeys.CurrentUser(c)
	var req struct {
		Role  string          `json:"role"`
		Parts json.RawMessage `json:"parts"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	role := strings.TrimSpace(req.Role)
	if _, ok := allowedRoles[role]; !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role"})
		return
	}
	if len(req.Parts) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "parts is required"})
		return
	}
	if len(req.Parts) > maxPartsBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "parts too large"})
		return
	}
	var decoded []json.RawMessage
	if err := json.Unmarshal(req.Parts, &decoded); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "parts must be a JSON array"})
		return
	}
	if len(decoded) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "parts must not be empty"})
		return
	}
	if err := h.validateMessageParts(user.ID, decoded); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	id, err := ids.New("msg")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate id"})
		return
	}
	message, err := h.store.AppendChatMessage(c.Request.Context(), id, user.ID, c.Param("id"), role, req.Parts)
	if err != nil {
		respondStoreError(c, err, "failed to append message")
		return
	}
	c.JSON(http.StatusCreated, message)
}

func respondStoreError(c *gin.Context, err error, fallback string) {
	if errors.Is(err, ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "chat not found"})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": fallback})
}
