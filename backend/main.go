package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/router-for-me/CLIProxyAPI/v6/sdk/access"
	"github.com/router-for-me/CLIProxyAPI/v6/sdk/api"
	"github.com/router-for-me/CLIProxyAPI/v6/sdk/api/handlers"
	sdkauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/auth"
	"github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy"
	coreauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
	"github.com/router-for-me/CLIProxyAPI/v6/sdk/config"
	"kaizhi/backend/internal/adminusers"
	"kaizhi/backend/internal/apikeys"
	"kaizhi/backend/internal/appconfig"
	"kaizhi/backend/internal/auth"
	"kaizhi/backend/internal/chats"
	"kaizhi/backend/internal/modelprices"
	"kaizhi/backend/internal/postgres"
	"kaizhi/backend/internal/provider"
	appusage "kaizhi/backend/internal/usage"
	"kaizhi/backend/internal/users"
	"kaizhi/backend/internal/xrayproxy"
	"kaizhi/backend/web"
)

const (
	kaizhiDataDirEnv         = "KAIZHI_DATA_DIR"
	kaizhiProxyURLEnv        = "KAIZHI_PROXY_URL"
	kaizhiDefaultLanguageEnv = "KAIZHI_PUBLIC_DEFAULT_LANGUAGE"
	kaizhiPublicBaseURLEnv   = "KAIZHI_PUBLIC_BASE_URL"
	defaultDataDirName       = "data"
	defaultConfigName        = "config.yaml"
	defaultAuthDirName       = "auths"
	defaultMediaDir          = "media"
)

func defaultCLIProxyConfig(authDir string) string {
	authDir = strings.TrimSpace(authDir)
	if authDir == "" {
		authDir = defaultAuthDirName
	}
	return `host: "127.0.0.1"
port: 8317
auth-dir: ` + strconv.Quote(filepath.ToSlash(authDir)) + `
proxy-url: ` + strconv.Quote(xrayproxy.ProxyURL(xrayproxy.DefaultSOCKS5Addr)) + `
api-keys: []
remote-management:
  allow-remote: false
  secret-key: ""
`
}

func main() {
	_ = godotenv.Load()

	dataDir, dataDirConfigured, err := resolveKaizhiDataDir()
	if err != nil {
		log.Fatalf("resolve %s: %v", kaizhiDataDirEnv, err)
	}
	if dataDirConfigured {
		if err := os.MkdirAll(dataDir, 0o700); err != nil {
			log.Fatalf("create %s: %v", kaizhiDataDirEnv, err)
		}
	}

	defaultConfigPath := defaultConfigName
	if dataDirConfigured {
		defaultConfigPath = filepath.Join(dataDir, defaultConfigName)
	}
	configPath := flag.String("config", defaultConfigPath, "path to CLIProxyAPI config file")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	resolvedConfigPath, err := expandPath(*configPath)
	if err != nil {
		log.Fatalf("resolve config path: %v", err)
	}
	absConfigPath, err := filepath.Abs(resolvedConfigPath)
	if err != nil {
		log.Fatalf("resolve config path: %v", err)
	}

	if _, err := os.Stat(absConfigPath); os.IsNotExist(err) {
		if err := os.MkdirAll(filepath.Dir(absConfigPath), 0o700); err != nil {
			log.Fatalf("create config directory: %v", err)
		}
		defaultAuthDir := defaultAuthDirName
		if dataDirConfigured {
			defaultAuthDir = filepath.Join(dataDir, defaultAuthDirName)
		}
		if err := os.WriteFile(absConfigPath, []byte(defaultCLIProxyConfig(defaultAuthDir)), 0o600); err != nil {
			log.Fatalf("write default config: %v", err)
		}
	} else if err != nil {
		log.Fatalf("stat config: %v", err)
	}

	db, err := postgres.Open(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatalf("connect postgres: %v", err)
	}
	defer db.Close()

	if err := postgres.EnsureSchema(ctx, db); err != nil {
		log.Fatalf("ensure postgres schema: %v", err)
	}
	userStore := users.NewStore(db, users.WithDefaultLanguage(os.Getenv(kaizhiDefaultLanguageEnv)))

	if adminEmail, adminPassword := os.Getenv("ADMIN_EMAIL"), os.Getenv("ADMIN_PASSWORD"); adminEmail != "" && adminPassword != "" {
		action, err := users.EnsureAdmin(ctx, userStore, adminEmail, adminPassword)
		if err != nil {
			log.Fatalf("ensure admin user: %v", err)
		}
		switch action {
		case users.AdminCreated:
			log.Printf("created admin user %s from ADMIN_EMAIL/ADMIN_PASSWORD", adminEmail)
		case users.AdminPasswordUpdated:
			log.Printf("updated admin user %s password from ADMIN_PASSWORD", adminEmail)
		case users.AdminRoleUpdated:
			log.Printf("promoted admin user %s from ADMIN_EMAIL", adminEmail)
		case users.AdminUpdated:
			log.Printf("updated admin user %s password and role from ADMIN_EMAIL/ADMIN_PASSWORD", adminEmail)
		}
	}
	apiKeyStore := apikeys.NewStore(db)
	usageStore := appusage.NewStore(db)
	chatStore := chats.NewStore(db)
	modelPriceStore := modelprices.NewStore(db)

	apiKeyService, err := apikeys.NewService(apiKeyStore, os.Getenv("API_KEY_PEPPER"))
	if err != nil {
		log.Fatalf("configure api key service: %v", err)
	}

	access.RegisterProvider("kaizhi-api-key", apikeys.NewAccessProvider(apiKeyService, userStore))
	authHandlers := auth.NewHandlers(userStore, apiKeyService)
	adminUserHandlers := adminusers.NewHandlers(userStore, adminusers.NewStore(db), apiKeyService)
	apiKeyHandlers := apikeys.NewHandlers(apiKeyStore, apiKeyService, userStore)
	appConfigHandlers := appconfig.NewHandlers(os.Getenv(kaizhiPublicBaseURLEnv))
	usageHandlers := appusage.NewHandlers(usageStore, userStore, apiKeyService)
	modelPriceHandlers := modelprices.NewHandlers(modelPriceStore, userStore, apiKeyService)
	mediaRoot := filepath.Join(defaultDataDirName, defaultMediaDir)
	if dataDirConfigured {
		mediaRoot = filepath.Join(dataDir, defaultMediaDir)
	}
	chatHandlers := chats.NewHandlers(
		chatStore,
		userStore,
		apiKeyService,
		chats.WithMediaRoot(mediaRoot),
	)

	cfg, err := config.LoadConfig(absConfigPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	if dataDirConfigured {
		cfg.AuthDir, err = resolveDataDirPath(cfg.AuthDir, dataDir, defaultAuthDirName)
		if err != nil {
			log.Fatalf("resolve auth-dir: %v", err)
		}
		if err := os.MkdirAll(cfg.AuthDir, 0o700); err != nil {
			log.Fatalf("create auth-dir: %v", err)
		}
	}

	upstreamProxyURL := strings.TrimSpace(os.Getenv(kaizhiProxyURLEnv))
	xraySocks, err := xrayproxy.StartSOCKS5(ctx, xrayproxy.DefaultSOCKS5Addr, upstreamProxyURL)
	if err != nil {
		log.Fatalf("start xray-core socks5 proxy: %v", err)
	}
	defer func() {
		if err := xraySocks.Close(); err != nil {
			log.Printf("close xray-core socks5 proxy: %v", err)
		}
	}()
	cfg.ProxyURL = xraySocks.ProxyURL()
	if upstreamProxyURL != "" {
		log.Printf("started xray-core socks5 proxy on %s with %s; CLIProxyAPI proxy-url=%s", xraySocks.Addr(), kaizhiProxyURLEnv, cfg.ProxyURL)
	} else {
		log.Printf("started xray-core socks5 proxy on %s; CLIProxyAPI proxy-url=%s", xraySocks.Addr(), cfg.ProxyURL)
	}

	tokenStore := sdkauth.GetTokenStore()
	if dirSetter, ok := tokenStore.(interface{ SetBaseDir(string) }); ok {
		dirSetter.SetBaseDir(cfg.AuthDir)
	}
	coreManager := coreauth.NewManager(tokenStore, nil, nil)
	providerOAuthHandlers := provider.NewHandlers(
		apiKeyService,
		userStore,
		api.NewManagementTokenRequester(cfg, coreManager),
		tokenStore,
		coreManager,
		absConfigPath,
	)
	providerOAuthHandlers.SetCLIProxyConfig(cfg)

	svc, err := cliproxy.NewBuilder().
		WithConfig(cfg).
		WithConfigPath(absConfigPath).
		WithCoreAuthManager(coreManager).
		WithServerOptions(
			api.WithMiddleware(web.APICacheMiddleware()),
			api.WithMiddleware(web.SPAMiddleware()),
			api.WithRouterConfigurator(func(engine *gin.Engine, _ *handlers.BaseAPIHandler, _ *config.Config) {
				authHandlers.RegisterRoutes(engine)
				adminUserHandlers.RegisterRoutes(engine)
				appConfigHandlers.RegisterRoutes(engine)
				apiKeyHandlers.RegisterRoutes(engine)
				usageHandlers.RegisterRoutes(engine)
				modelPriceHandlers.RegisterRoutes(engine)
				chatHandlers.RegisterRoutes(engine)
				providerOAuthHandlers.RegisterRoutes(engine)
				engine.NoRoute(web.NoRouteHandler())
			}),
		).
		Build()
	if err != nil {
		log.Fatalf("build CLIProxyAPI service: %v", err)
	}

	svc.RegisterUsagePlugin(appusage.NewRecorder(usageStore, apiKeyStore))

	if err := svc.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatalf("run CLIProxyAPI service: %v", err)
	}
}

func resolveKaizhiDataDir() (string, bool, error) {
	raw := strings.TrimSpace(os.Getenv(kaizhiDataDirEnv))
	if raw == "" {
		return "", false, nil
	}
	path, err := expandPath(raw)
	if err != nil {
		return "", true, err
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", true, err
	}
	return filepath.Clean(abs), true, nil
}

func resolveDataDirPath(path, dataDir, fallback string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		path = fallback
	}
	path, err := expandPath(path)
	if err != nil {
		return "", err
	}
	if filepath.IsAbs(path) {
		return filepath.Clean(path), nil
	}
	return filepath.Join(dataDir, path), nil
}

func expandPath(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "~" {
		return os.UserHomeDir()
	}
	if strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, strings.TrimPrefix(path, "~/")), nil
	}
	return path, nil
}
