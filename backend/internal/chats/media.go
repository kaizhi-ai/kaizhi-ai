package chats

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"kaizhi/backend/internal/apikeys"
	"kaizhi/backend/internal/ids"
	"kaizhi/backend/internal/users"
)

const maxUploadBytes = 5 * 1024 * 1024

const chatMediaURLPrefix = "/api/v1/chats/media/"

type imageKind struct {
	mediaType string
	ext       string
}

var imageKindsByExt = map[string]imageKind{
	".gif":  {mediaType: "image/gif", ext: "gif"},
	".jpg":  {mediaType: "image/jpeg", ext: "jpg"},
	".jpeg": {mediaType: "image/jpeg", ext: "jpg"},
	".png":  {mediaType: "image/png", ext: "png"},
	".webp": {mediaType: "image/webp", ext: "webp"},
}

func (h *Handlers) uploadAttachment(c *gin.Context) {
	user := apikeys.CurrentUser(c)
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxUploadBytes+(1<<20))

	header, err := c.FormFile("file")
	if err != nil {
		if strings.Contains(err.Error(), "request body too large") {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "单张图片不能超过 5MB"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "未选择文件"})
		return
	}
	if header.Size <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未选择文件"})
		return
	}
	if header.Size > maxUploadBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "单张图片不能超过 5MB"})
		return
	}

	file, err := header.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "读取文件失败"})
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxUploadBytes+1))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "读取文件失败"})
		return
	}
	if len(data) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未选择文件"})
		return
	}
	if len(data) > maxUploadBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "单张图片不能超过 5MB"})
		return
	}

	kind, ok := detectImageKind(data)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "仅支持 PNG / JPEG / WebP / GIF"})
		return
	}

	if err := os.MkdirAll(h.chatUserMediaDir(user.ID), 0o700); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建上传目录失败"})
		return
	}

	id, err := ids.New("file")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成文件名失败"})
		return
	}
	filename := id + "." + kind.ext
	rawURL := chatMediaURLPrefix + user.ID + "/" + filename
	_, target, ok := h.resolveChatMediaPath(user.ID, filename)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成文件路径失败"})
		return
	}
	if err := os.WriteFile(target, data, 0o600); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存文件失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"url":       rawURL,
		"mediaType": kind.mediaType,
		"name":      cleanUploadName(header.Filename, kind.ext),
		"size":      len(data),
	})
}

func (h *Handlers) serveAttachment(c *gin.Context) {
	userID := c.Param("user_id")
	filename := c.Param("filename")

	user := h.authenticateMediaRequestUser(c)
	if user == nil {
		c.Status(http.StatusUnauthorized)
		return
	}
	if userID != user.ID {
		c.Status(http.StatusNotFound)
		return
	}

	kind, ok := imageKindForFilename(filename)
	if !ok {
		c.Status(http.StatusNotFound)
		return
	}

	_, target, ok := h.resolveChatMediaPath(userID, filename)
	if !ok {
		c.Status(http.StatusNotFound)
		return
	}

	file, err := os.Open(target)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		c.Status(http.StatusNotFound)
		return
	}

	c.Header("Cache-Control", "private, max-age=3600")
	c.Header("Content-Length", strconv.FormatInt(info.Size(), 10))
	c.Header("Content-Type", kind.mediaType)
	c.Header("X-Content-Type-Options", "nosniff")
	http.ServeContent(c.Writer, c.Request, filename, info.ModTime(), file)
}

func detectImageKind(data []byte) (imageKind, bool) {
	switch {
	case len(data) >= 8 &&
		data[0] == 0x89 &&
		data[1] == 'P' &&
		data[2] == 'N' &&
		data[3] == 'G' &&
		data[4] == '\r' &&
		data[5] == '\n' &&
		data[6] == 0x1a &&
		data[7] == '\n':
		return imageKind{mediaType: "image/png", ext: "png"}, true
	case len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff:
		return imageKind{mediaType: "image/jpeg", ext: "jpg"}, true
	case len(data) >= 6 && (string(data[:6]) == "GIF87a" || string(data[:6]) == "GIF89a"):
		return imageKind{mediaType: "image/gif", ext: "gif"}, true
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return imageKind{mediaType: "image/webp", ext: "webp"}, true
	default:
		return imageKind{}, false
	}
}

func imageKindForFilename(filename string) (imageKind, bool) {
	if !isSafeFilename(filename) {
		return imageKind{}, false
	}
	kind, ok := imageKindsByExt[strings.ToLower(filepath.Ext(filename))]
	return kind, ok
}

func (h *Handlers) validateMessageParts(userID string, parts []json.RawMessage) error {
	for _, raw := range parts {
		var envelope struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(raw, &envelope); err != nil {
			return errors.New("parts must contain JSON objects")
		}
		if envelope.Type != "file" {
			continue
		}

		var part struct {
			MediaType string `json:"mediaType"`
			URL       string `json:"url"`
		}
		if err := json.Unmarshal(raw, &part); err != nil {
			return errors.New("file attachment is invalid")
		}
		if err := h.validateLocalChatImageURL(userID, part.URL, part.MediaType); err != nil {
			return err
		}
	}
	return nil
}

func (h *Handlers) validateLocalChatImageURL(userID, rawURL, mediaType string) error {
	filename, err := localChatImageFilename(userID, rawURL, mediaType)
	if err != nil {
		return err
	}

	_, target, ok := h.resolveChatMediaPath(userID, filename)
	if !ok {
		return errors.New("file attachments must use local chat media URLs")
	}
	info, err := os.Stat(target)
	if err != nil || !info.Mode().IsRegular() {
		return errors.New("file attachment not found")
	}
	return nil
}

func localChatImageFilename(userID, rawURL, mediaType string) (string, error) {
	if strings.TrimSpace(rawURL) == "" || rawURL != strings.TrimSpace(rawURL) {
		return "", errors.New("file attachments must use local chat media URLs")
	}
	parsed, err := url.Parse(rawURL)
	if err != nil ||
		parsed.IsAbs() ||
		parsed.Host != "" ||
		parsed.RawQuery != "" ||
		parsed.Fragment != "" ||
		parsed.Path != rawURL {
		return "", errors.New("file attachments must use local chat media URLs")
	}
	if !strings.HasPrefix(parsed.Path, chatMediaURLPrefix) {
		return "", errors.New("file attachments must use local chat media URLs")
	}

	rest := strings.TrimPrefix(parsed.Path, chatMediaURLPrefix)
	segments := strings.Split(rest, "/")
	if len(segments) != 2 || segments[0] != userID {
		return "", errors.New("file attachments must use local chat media URLs")
	}

	kind, ok := imageKindForFilename(segments[1])
	if !ok || mediaType != kind.mediaType {
		return "", errors.New("file attachment must be a supported local image")
	}
	return segments[1], nil
}

func (h *Handlers) chatMediaFiles(userID string, messages []ChatMessage) map[string]string {
	files := make(map[string]string)
	for _, message := range messages {
		var parts []struct {
			Type      string `json:"type"`
			MediaType string `json:"mediaType"`
			URL       string `json:"url"`
		}
		if err := json.Unmarshal(message.Parts, &parts); err != nil {
			continue
		}
		for _, part := range parts {
			if part.Type != "file" {
				continue
			}
			filename, err := localChatImageFilename(userID, part.URL, part.MediaType)
			if err != nil {
				continue
			}
			_, target, ok := h.resolveChatMediaPath(userID, filename)
			if ok {
				files[part.URL] = target
			}
		}
	}
	return files
}

func (h *Handlers) deleteUnreferencedChatMediaFiles(ctx context.Context, userID string, files map[string]string) error {
	if len(files) == 0 {
		return nil
	}
	urls := make([]string, 0, len(files))
	for rawURL := range files {
		urls = append(urls, rawURL)
	}
	references, err := h.store.CountFilePartURLReferences(ctx, userID, urls)
	if err != nil {
		return err
	}

	var firstErr error
	for rawURL, target := range files {
		if references[rawURL] > 0 {
			continue
		}
		if err := os.Remove(target); err != nil && !errors.Is(err, os.ErrNotExist) {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		pruneEmptyDirs(filepath.Dir(target), h.chatUserMediaDir(userID))
	}
	return firstErr
}

func pruneEmptyDirs(start, stop string) {
	start = filepath.Clean(start)
	stop = filepath.Clean(stop)
	for dir := start; dir != "" && strings.HasPrefix(dir, stop); dir = filepath.Dir(dir) {
		if err := os.Remove(dir); err != nil {
			return
		}
		if dir == stop {
			return
		}
	}
}

func (h *Handlers) authenticateMediaRequestUser(c *gin.Context) *users.User {
	raw := apikeys.ExtractBearer(c.GetHeader("Authorization"))
	if raw == "" {
		return nil
	}
	key, err := h.apiKeys.Authenticate(c.Request.Context(), raw)
	if err != nil || key.Kind != apikeys.KindSession {
		return nil
	}
	user, err := h.users.GetUserByID(c.Request.Context(), key.UserID)
	if err != nil || user.Status != users.StatusActive {
		return nil
	}
	return user
}

func cleanUploadName(name, fallbackExt string) string {
	name = strings.TrimSpace(strings.ReplaceAll(name, "\\", "/"))
	if name != "" {
		name = filepath.Base(name)
	}
	if name == "." || name == "/" || name == "" {
		return "image." + fallbackExt
	}
	return name
}

func (h *Handlers) chatUserMediaDir(userID string) string {
	return filepath.Join(h.mediaRoot, "chat", userID)
}

func (h *Handlers) resolveChatMediaPath(userID, filename string) (string, string, bool) {
	if !isSafeFilename(filename) {
		return "", "", false
	}
	userDir := h.chatUserMediaDir(userID)
	target := filepath.Join(userDir, filename)
	rel, err := filepath.Rel(userDir, target)
	if err != nil || rel == "." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || rel == ".." {
		return "", "", false
	}
	return userDir, target, true
}

func isSafeFilename(filename string) bool {
	if filename == "" || filename == "." || filename == ".." {
		return false
	}
	if strings.Contains(filename, "/") || strings.Contains(filename, "\\") || strings.Contains(filename, "..") {
		return false
	}
	return filepath.Base(filename) == filename
}
