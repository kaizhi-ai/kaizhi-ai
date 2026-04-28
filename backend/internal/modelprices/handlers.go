package modelprices

import (
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"kaizhi/backend/internal/apikeys"
	"kaizhi/backend/internal/users"
)

const maxDecimalIntegerDigits = 12

var decimalPattern = regexp.MustCompile(`^(\d+)(?:\.\d{1,8})?$`)

type Handlers struct {
	store   *Store
	users   *users.Store
	apiKeys *apikeys.Service
}

type priceRequest struct {
	Model                   string  `json:"model"`
	InputUSDPerMillion      string  `json:"input_usd_per_million"`
	CacheReadUSDPerMillion  *string `json:"cache_read_usd_per_million"`
	CacheWriteUSDPerMillion *string `json:"cache_write_usd_per_million"`
	OutputUSDPerMillion     string  `json:"output_usd_per_million"`
	ReasoningUSDPerMillion  *string `json:"reasoning_usd_per_million"`
	Note                    string  `json:"note"`
}

func NewHandlers(store *Store, userStore *users.Store, apiKeys *apikeys.Service) *Handlers {
	return &Handlers{store: store, users: userStore, apiKeys: apiKeys}
}

func (h *Handlers) RegisterRoutes(engine *gin.Engine) {
	group := engine.Group("/api/v1/admin/model-prices")
	group.Use(apikeys.AuthMiddleware(h.apiKeys, h.users), apikeys.RequireAdmin())
	group.GET("", h.list)
	group.GET("/unmatched", h.unmatched)
	group.POST("/import-defaults", h.importDefaults)
	group.POST("", h.create)
	group.PATCH("/:id", h.update)
	group.DELETE("/:id", h.delete)
}

func (h *Handlers) list(c *gin.Context) {
	items, err := h.store.List(c.Request.Context(), ListParams{
		Query: c.Query("q"),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list model prices"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"prices": PublicPrices(items)})
}

func (h *Handlers) create(c *gin.Context) {
	var req priceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	params, err := req.saveParams()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	price, err := h.store.Create(c.Request.Context(), params)
	if err != nil {
		writeStoreError(c, err, "failed to create model price")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"price": PublicPrice(*price)})
}

func (h *Handlers) importDefaults(c *gin.Context) {
	result, err := h.store.ImportDefaultPrices(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to import default model prices"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"result": result})
}

func (h *Handlers) update(c *gin.Context) {
	var req priceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	params, err := req.saveParams()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	price, err := h.store.Update(c.Request.Context(), c.Param("id"), params)
	if err != nil {
		writeStoreError(c, err, "failed to update model price")
		return
	}
	c.JSON(http.StatusOK, gin.H{"price": PublicPrice(*price)})
}

func (h *Handlers) delete(c *gin.Context) {
	if err := h.store.Delete(c.Request.Context(), c.Param("id")); err != nil {
		writeStoreError(c, err, "failed to delete model price")
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handlers) unmatched(c *gin.Context) {
	from, to, err := priceRange(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	items, err := h.store.ListUnmatched(c.Request.Context(), from, to)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list unmatched models"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"from":   from.Format("2006-01-02"),
		"to":     to.Format("2006-01-02"),
		"models": items,
	})
}

func (r priceRequest) saveParams() (SaveParams, error) {
	model := strings.TrimSpace(r.Model)
	if model == "" {
		return SaveParams{}, errors.New("model is required")
	}

	input, err := requiredDecimal(r.InputUSDPerMillion, "input_usd_per_million")
	if err != nil {
		return SaveParams{}, err
	}
	output, err := requiredDecimal(r.OutputUSDPerMillion, "output_usd_per_million")
	if err != nil {
		return SaveParams{}, err
	}
	cacheRead, err := optionalDecimal(r.CacheReadUSDPerMillion, "cache_read_usd_per_million")
	if err != nil {
		return SaveParams{}, err
	}
	cacheWrite, err := optionalDecimal(r.CacheWriteUSDPerMillion, "cache_write_usd_per_million")
	if err != nil {
		return SaveParams{}, err
	}
	reasoning, err := optionalDecimal(r.ReasoningUSDPerMillion, "reasoning_usd_per_million")
	if err != nil {
		return SaveParams{}, err
	}

	return SaveParams{
		Model:                   model,
		InputUSDPerMillion:      input,
		CacheReadUSDPerMillion:  cacheRead,
		CacheWriteUSDPerMillion: cacheWrite,
		OutputUSDPerMillion:     output,
		ReasoningUSDPerMillion:  reasoning,
		Note:                    strings.TrimSpace(r.Note),
	}, nil
}

func priceRange(c *gin.Context) (time.Time, time.Time, error) {
	now := time.Now().UTC()
	from := now.AddDate(0, 0, -30)
	to := now
	if raw := strings.TrimSpace(c.Query("from")); raw != "" {
		parsed, err := parseDate(raw, "from")
		if err != nil {
			return time.Time{}, time.Time{}, err
		}
		from = parsed
	}
	if raw := strings.TrimSpace(c.Query("to")); raw != "" {
		parsed, err := parseDate(raw, "to")
		if err != nil {
			return time.Time{}, time.Time{}, err
		}
		to = parsed
	}
	if from.After(to) {
		return time.Time{}, time.Time{}, errors.New("from must be on or before to")
	}
	return from, to, nil
}

func requiredDecimal(raw, name string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", errors.New(name + " is required")
	}
	if !validPriceDecimal(value) {
		return "", decimalValidationError(name)
	}
	return value, nil
}

func optionalDecimal(raw *string, name string) (*string, error) {
	if raw == nil {
		return nil, nil
	}
	value := strings.TrimSpace(*raw)
	if value == "" {
		return nil, nil
	}
	if !validPriceDecimal(value) {
		return nil, decimalValidationError(name)
	}
	return &value, nil
}

func validPriceDecimal(value string) bool {
	matches := decimalPattern.FindStringSubmatch(value)
	if matches == nil {
		return false
	}
	integerDigits := strings.TrimLeft(matches[1], "0")
	return len(integerDigits) <= maxDecimalIntegerDigits
}

func decimalValidationError(name string) error {
	return errors.New(name + " must be a non-negative decimal with at most 12 integer digits and 8 fractional digits")
}

func parseDate(raw, name string) (time.Time, error) {
	parsed, err := time.Parse("2006-01-02", strings.TrimSpace(raw))
	if err != nil {
		return time.Time{}, errors.New(name + " must be YYYY-MM-DD")
	}
	return parsed, nil
}

func writeStoreError(c *gin.Context, err error, fallback string) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "model price not found"})
	case errors.Is(err, ErrConflict):
		c.JSON(http.StatusConflict, gin.H{"error": "model price already exists"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": fallback})
	}
}
