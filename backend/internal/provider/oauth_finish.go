package provider

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	oauthCompletionTimeout      = 5 * time.Minute
	oauthCompletionPollInterval = 500 * time.Millisecond
)

type oauthStatusPayload struct {
	Status string `json:"status"`
	Error  string `json:"error"`
}

type oauthHTTPError struct {
	StatusCode int
	Message    string
}

func (e *oauthHTTPError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

func (h *Handlers) submitOAuthCallback(c *gin.Context, payload map[string]string) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return &oauthHTTPError{
			StatusCode: http.StatusInternalServerError,
			Message:    "failed to prepare oauth callback",
		}
	}

	originalWriter := c.Writer
	writer := newCaptureWriter(originalWriter, false)
	c.Writer = writer
	c.Request.Body = io.NopCloser(bytes.NewReader(data))
	c.Request.ContentLength = int64(len(data))
	c.Request.Header.Set("Content-Type", "application/json")
	h.requester.PostOAuthCallback(c)
	c.Writer = originalWriter

	if writer.Status() != http.StatusOK {
		return &oauthHTTPError{
			StatusCode: writer.Status(),
			Message:    firstNonEmpty(errorMessageFromBody(writer.body.Bytes()), "oauth callback failed"),
		}
	}
	return nil
}

func (h *Handlers) waitForOAuthCompletion(c *gin.Context, state string) error {
	state = strings.TrimSpace(state)
	if state == "" {
		return &oauthHTTPError{StatusCode: http.StatusBadRequest, Message: "state is required"}
	}

	timeout := time.NewTimer(oauthCompletionTimeout)
	defer timeout.Stop()
	ticker := time.NewTicker(oauthCompletionPollInterval)
	defer ticker.Stop()

	for {
		status, err := h.pollOAuthStatus(c, state)
		if err != nil {
			return err
		}
		switch status.Status {
		case "ok":
			return nil
		case "error":
			return &oauthHTTPError{StatusCode: http.StatusBadGateway, Message: firstNonEmpty(status.Error, "oauth login failed")}
		case "wait", "":
		default:
			return &oauthHTTPError{StatusCode: http.StatusBadGateway, Message: "unexpected oauth status"}
		}

		select {
		case <-c.Request.Context().Done():
			return &oauthHTTPError{StatusCode: http.StatusRequestTimeout, Message: "oauth completion canceled"}
		case <-timeout.C:
			return &oauthHTTPError{StatusCode: http.StatusGatewayTimeout, Message: "oauth completion timed out"}
		case <-ticker.C:
		}
	}
}

func (h *Handlers) pollOAuthStatus(c *gin.Context, state string) (oauthStatusPayload, error) {
	originalWriter := c.Writer
	originalRawQuery := c.Request.URL.RawQuery
	writer := newCaptureWriter(originalWriter, false)

	query := c.Request.URL.Query()
	query.Set("state", state)
	c.Request.URL.RawQuery = query.Encode()
	c.Writer = writer
	h.requester.GetAuthStatus(c)
	c.Writer = originalWriter
	c.Request.URL.RawQuery = originalRawQuery

	if writer.Status() != http.StatusOK {
		return oauthStatusPayload{}, &oauthHTTPError{
			StatusCode: writer.Status(),
			Message:    firstNonEmpty(errorMessageFromBody(writer.body.Bytes()), "oauth status check failed"),
		}
	}

	var resp oauthStatusPayload
	if err := json.Unmarshal(writer.body.Bytes(), &resp); err != nil {
		return oauthStatusPayload{}, err
	}
	resp.Status = strings.TrimSpace(resp.Status)
	resp.Error = strings.TrimSpace(resp.Error)
	return resp, nil
}

func stateFromFinishPayload(payload map[string]string) string {
	if payload == nil {
		return ""
	}
	if state := strings.TrimSpace(payload["state"]); state != "" {
		return state
	}
	return stateFromCallbackText(payload["redirect_url"])
}

func stateFromCallbackText(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if parsed, err := url.Parse(raw); err == nil {
		if state := strings.TrimSpace(parsed.Query().Get("state")); state != "" {
			return state
		}
		if state := stateFromQueryText(parsed.Fragment); state != "" {
			return state
		}
	}
	return stateFromQueryText(raw)
}

func stateFromQueryText(raw string) string {
	raw = strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(raw, "?"), "#"))
	if raw == "" || !strings.Contains(raw, "state=") {
		return ""
	}
	values, err := url.ParseQuery(raw)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(values.Get("state"))
}

func writeOAuthError(c *gin.Context, err error) {
	if err == nil {
		return
	}
	if oauthErr, ok := err.(*oauthHTTPError); ok {
		status := oauthErr.StatusCode
		if status == 0 {
			status = http.StatusInternalServerError
		}
		c.JSON(status, gin.H{"error": firstNonEmpty(oauthErr.Message, "oauth request failed")})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": "oauth request failed"})
}

func errorMessageFromBody(data []byte) string {
	data = bytes.TrimSpace(data)
	if len(data) == 0 {
		return ""
	}
	var body struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(data, &body); err == nil {
		return firstNonEmpty(body.Error, body.Message)
	}
	return string(data)
}

type captureWriter struct {
	gin.ResponseWriter
	body    bytes.Buffer
	status  int
	size    int
	forward bool
}

func newCaptureWriter(writer gin.ResponseWriter, forward bool) *captureWriter {
	return &captureWriter{
		ResponseWriter: writer,
		status:         http.StatusOK,
		size:           -1,
		forward:        forward,
	}
}

func (w *captureWriter) WriteHeader(code int) {
	if code > 0 && w.status != code && !w.Written() {
		w.status = code
	}
	if w.forward {
		w.ResponseWriter.WriteHeader(code)
	}
}

func (w *captureWriter) WriteHeaderNow() {
	if !w.Written() {
		w.size = 0
		if w.forward {
			w.ResponseWriter.WriteHeaderNow()
		}
	}
}

func (w *captureWriter) Write(data []byte) (int, error) {
	w.WriteHeaderNow()
	n, _ := w.body.Write(data)
	w.size += n
	if !w.forward {
		return n, nil
	}
	_, err := w.ResponseWriter.Write(data)
	return n, err
}

func (w *captureWriter) WriteString(s string) (int, error) {
	w.WriteHeaderNow()
	n, _ := w.body.WriteString(s)
	w.size += n
	if !w.forward {
		return n, nil
	}
	_, err := w.ResponseWriter.WriteString(s)
	return n, err
}

func (w *captureWriter) Status() int {
	return w.status
}

func (w *captureWriter) Size() int {
	return w.size
}

func (w *captureWriter) Written() bool {
	return w.size != -1
}
