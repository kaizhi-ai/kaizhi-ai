package adminusers

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"kaizhi/backend/internal/apikeys"
	"kaizhi/backend/internal/users"
)

const minPasswordLength = 8

var costUSDPattern = regexp.MustCompile(`^(0|[1-9][0-9]{0,17})(\.[0-9]{1,12})?$`)

type Handlers struct {
	userStore *users.Store
	store     *Store
	apiKeys   *apikeys.Service
}

type userResponse struct {
	ID               string     `json:"id"`
	Email            string     `json:"email"`
	Name             string     `json:"name"`
	Language         string     `json:"language"`
	Status           string     `json:"status"`
	Role             string     `json:"role"`
	Quota5HCostUSD   *string    `json:"quota_5h_cost_usd"`
	Quota7DCostUSD   *string    `json:"quota_7d_cost_usd"`
	Usage5HCostUSD   string     `json:"usage_5h_cost_usd"`
	Usage7DCostUSD   string     `json:"usage_7d_cost_usd"`
	Usage5HStartedAt time.Time  `json:"usage_5h_started_at"`
	Usage7DStartedAt time.Time  `json:"usage_7d_started_at"`
	Usage5HResetAt   *time.Time `json:"usage_5h_reset_at"`
	Usage7DResetAt   *time.Time `json:"usage_7d_reset_at"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

func NewHandlers(userStore *users.Store, store *Store, apiKeys *apikeys.Service) *Handlers {
	return &Handlers{userStore: userStore, store: store, apiKeys: apiKeys}
}

func (h *Handlers) RegisterRoutes(engine *gin.Engine) {
	group := engine.Group("/api/v1/admin/users")
	group.Use(apikeys.AuthMiddleware(h.apiKeys, h.userStore), apikeys.RequireAdmin())
	group.GET("", h.list)
	group.POST("", h.create)
	group.PATCH("/:id", h.update)
	group.POST("/:id/password", h.resetPassword)
	group.POST("/:id/ban", h.ban)
	group.POST("/:id/unban", h.unban)
}

func (h *Handlers) list(c *gin.Context) {
	items, err := h.userStore.ListUsers(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list users"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"users": publicUsers(items)})
}

func (h *Handlers) create(c *gin.Context) {
	var req struct {
		Email          string            `json:"email"`
		Name           string            `json:"name"`
		Language       *string           `json:"language"`
		Password       string            `json:"password"`
		Role           string            `json:"role"`
		Quota5HCostUSD nullableCostField `json:"quota_5h_cost_usd"`
		Quota7DCostUSD nullableCostField `json:"quota_7d_cost_usd"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	email, ok := validateEmail(req.Email)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email is required"})
		return
	}
	if len(req.Password) < minPasswordLength {
		c.JSON(http.StatusBadRequest, gin.H{"error": "password must be at least 8 characters"})
		return
	}
	name, ok := validateName(req.Name)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name must be at most 80 characters"})
		return
	}
	language := ""
	if req.Language != nil && strings.TrimSpace(*req.Language) != "" {
		language, ok = validateLanguage(*req.Language)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "language must be zh-CN or en-US"})
			return
		}
	}
	role, ok := normalizeRole(req.Role, users.RoleUser)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "role must be user or admin"})
		return
	}
	var quotaParams users.UpdateUserParams
	if ok, message := applyQuotaCost(&quotaParams, req.Quota5HCostUSD, "quota_5h_cost_usd"); !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": message})
		return
	}
	if ok, message := applyQuotaCost(&quotaParams, req.Quota7DCostUSD, "quota_7d_cost_usd"); !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": message})
		return
	}

	hash, err := users.HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}
	user, err := h.userStore.CreateUserWithRoleAndProfile(c.Request.Context(), email, hash, role, name, language)
	if err != nil {
		writeUserStoreError(c, err, "failed to create user")
		return
	}
	if quotaParams.Quota5HCostUSDSet || quotaParams.Quota7DCostUSDSet {
		user, err = h.userStore.UpdateUser(c.Request.Context(), user.ID, quotaParams)
		if err != nil {
			writeUserStoreError(c, err, "failed to create user")
			return
		}
	}
	c.JSON(http.StatusCreated, gin.H{"user": publicUser(user)})
}

func (h *Handlers) update(c *gin.Context) {
	current := apikeys.CurrentUser(c)
	targetID := c.Param("id")
	var req struct {
		Email          *string           `json:"email"`
		Name           *string           `json:"name"`
		Language       *string           `json:"language"`
		Role           *string           `json:"role"`
		Quota5HCostUSD nullableCostField `json:"quota_5h_cost_usd"`
		Quota7DCostUSD nullableCostField `json:"quota_7d_cost_usd"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	var params users.UpdateUserParams
	if req.Email != nil {
		email, ok := validateEmail(*req.Email)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "email is required"})
			return
		}
		params.Email = &email
	}
	if req.Name != nil {
		name, ok := validateName(*req.Name)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "name must be at most 80 characters"})
			return
		}
		params.Name = &name
	}
	if req.Language != nil {
		language, ok := validateLanguage(*req.Language)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "language must be zh-CN or en-US"})
			return
		}
		params.Language = &language
	}
	if req.Role != nil {
		if current != nil && targetID == current.ID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot change your own role"})
			return
		}
		role, ok := normalizeRole(*req.Role, "")
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "role must be user or admin"})
			return
		}
		params.Role = &role
	}
	if ok, message := applyQuotaCost(&params, req.Quota5HCostUSD, "quota_5h_cost_usd"); !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": message})
		return
	}
	if ok, message := applyQuotaCost(&params, req.Quota7DCostUSD, "quota_7d_cost_usd"); !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": message})
		return
	}

	user, err := h.userStore.UpdateUser(c.Request.Context(), targetID, params)
	if err != nil {
		writeUserStoreError(c, err, "failed to update user")
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": publicUser(user)})
}

func (h *Handlers) resetPassword(c *gin.Context) {
	var req struct {
		Password    string `json:"password"`
		NewPassword string `json:"new_password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	password := req.Password
	if password == "" {
		password = req.NewPassword
	}
	if len(password) < minPasswordLength {
		c.JSON(http.StatusBadRequest, gin.H{"error": "password must be at least 8 characters"})
		return
	}
	hash, err := users.HashPassword(password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}
	if err := h.store.ResetPasswordAndRevokeSessions(c.Request.Context(), c.Param("id"), hash); err != nil {
		writeUserStoreError(c, err, "failed to reset password")
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handlers) ban(c *gin.Context) {
	current := apikeys.CurrentUser(c)
	targetID := c.Param("id")
	if current != nil && targetID == current.ID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot ban yourself"})
		return
	}
	user, err := h.store.BanUserAndRevokeSessions(c.Request.Context(), targetID)
	if err != nil {
		writeUserStoreError(c, err, "failed to ban user")
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": publicUser(user)})
}

func (h *Handlers) unban(c *gin.Context) {
	status := users.StatusActive
	user, err := h.userStore.UpdateUser(c.Request.Context(), c.Param("id"), users.UpdateUserParams{Status: &status})
	if err != nil {
		writeUserStoreError(c, err, "failed to unban user")
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": publicUser(user)})
}

func publicUsers(items []users.User) []userResponse {
	out := make([]userResponse, 0, len(items))
	for i := range items {
		out = append(out, publicUser(&items[i]))
	}
	return out
}

func publicUser(user *users.User) userResponse {
	if user == nil {
		return userResponse{}
	}
	return userResponse{
		ID:               user.ID,
		Email:            user.Email,
		Name:             user.Name,
		Language:         user.Language,
		Status:           user.Status,
		Role:             user.Role,
		Quota5HCostUSD:   user.Quota5HCostUSD,
		Quota7DCostUSD:   user.Quota7DCostUSD,
		Usage5HCostUSD:   user.Usage5HCostUSD,
		Usage7DCostUSD:   user.Usage7DCostUSD,
		Usage5HStartedAt: user.Usage5HStartedAt,
		Usage7DStartedAt: user.Usage7DStartedAt,
		Usage5HResetAt:   user.Usage5HResetAt,
		Usage7DResetAt:   user.Usage7DResetAt,
		CreatedAt:        user.CreatedAt,
		UpdatedAt:        user.UpdatedAt,
	}
}

func validateEmail(raw string) (string, bool) {
	email := users.NormalizeEmail(raw)
	return email, email != "" && len(email) <= 320 && strings.Contains(email, "@")
}

func validateName(raw string) (string, bool) {
	return users.NormalizeName(raw)
}

func validateLanguage(raw string) (string, bool) {
	return users.NormalizeLanguage(raw)
}

func normalizeRole(raw, fallback string) (string, bool) {
	role := strings.TrimSpace(raw)
	if role == "" && fallback != "" {
		role = fallback
	}
	switch role {
	case users.RoleUser, users.RoleAdmin:
		return role, true
	default:
		return "", false
	}
}

type nullableCostField struct {
	Set   bool
	Value *string
}

func (f *nullableCostField) UnmarshalJSON(data []byte) error {
	f.Set = true
	raw := strings.TrimSpace(string(data))
	if raw == "null" {
		f.Value = nil
		return nil
	}
	var text string
	if err := json.Unmarshal(data, &text); err == nil {
		f.Value = &text
		return nil
	}
	var number json.Number
	if err := json.Unmarshal(data, &number); err == nil {
		text = number.String()
		f.Value = &text
		return nil
	}
	return errors.New("quota must be a string, number, or null")
}

func applyQuotaCost(params *users.UpdateUserParams, field nullableCostField, name string) (bool, string) {
	if !field.Set {
		return true, ""
	}
	switch name {
	case "quota_5h_cost_usd":
		params.Quota5HCostUSDSet = true
	case "quota_7d_cost_usd":
		params.Quota7DCostUSDSet = true
	default:
		return false, "invalid quota field"
	}
	if field.Value == nil {
		return true, ""
	}
	value := strings.TrimSpace(*field.Value)
	if value == "" {
		return true, ""
	}
	if !costUSDPattern.MatchString(value) {
		return false, name + " must be a non-negative USD amount with up to 18 integer digits and 12 decimal places"
	}
	if name == "quota_5h_cost_usd" {
		params.Quota5HCostUSD = &value
	} else {
		params.Quota7DCostUSD = &value
	}
	return true, ""
}

func writeUserStoreError(c *gin.Context, err error, fallback string) {
	status := http.StatusInternalServerError
	message := fallback
	if errors.Is(err, users.ErrNotFound) {
		status = http.StatusNotFound
		message = "user not found"
	} else if errors.Is(err, users.ErrEmailExists) {
		status = http.StatusConflict
		message = "email already exists"
	}
	c.JSON(status, gin.H{"error": message})
}
