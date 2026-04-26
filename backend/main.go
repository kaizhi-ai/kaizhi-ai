package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"os"
	"os/signal"
	"path/filepath"
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
	"kaizhi/backend/internal/apikeys"
	"kaizhi/backend/internal/auth"
	"kaizhi/backend/internal/chats"
	"kaizhi/backend/internal/postgres"
	"kaizhi/backend/internal/provider"
	appusage "kaizhi/backend/internal/usage"
	"kaizhi/backend/internal/users"
	"kaizhi/backend/web"
)

const defaultCLIProxyConfig = `host: "127.0.0.1"
port: 8317
auth-dir: "auths"
api-keys: []
remote-management:
  allow-remote: false
  secret-key: ""
`

func main() {
	_ = godotenv.Load()

	configPath := flag.String("config", "config.yaml", "path to CLIProxyAPI config file")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	absConfigPath, err := filepath.Abs(*configPath)
	if err != nil {
		log.Fatalf("resolve config path: %v", err)
	}

	if _, err := os.Stat(absConfigPath); os.IsNotExist(err) {
		if err := os.WriteFile(absConfigPath, []byte(defaultCLIProxyConfig), 0o600); err != nil {
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
	userStore := users.NewStore(db)

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

	apiKeyService, err := apikeys.NewService(apiKeyStore, os.Getenv("API_KEY_PEPPER"))
	if err != nil {
		log.Fatalf("configure api key service: %v", err)
	}

	access.RegisterProvider("kaizhi-api-key", apikeys.NewAccessProvider(apiKeyService))
	authHandlers := auth.NewHandlers(userStore, apiKeyService)
	apiKeyHandlers := apikeys.NewHandlers(apiKeyStore, apiKeyService, userStore)
	usageHandlers := appusage.NewHandlers(usageStore, userStore, apiKeyService)
	chatHandlers := chats.NewHandlers(chatStore, userStore, apiKeyService)

	cfg, err := config.LoadConfig(absConfigPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
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
	)

	svc, err := cliproxy.NewBuilder().
		WithConfig(cfg).
		WithConfigPath(absConfigPath).
		WithCoreAuthManager(coreManager).
		WithServerOptions(
			api.WithMiddleware(web.SPAMiddleware()),
			api.WithRouterConfigurator(func(engine *gin.Engine, _ *handlers.BaseAPIHandler, _ *config.Config) {
				authHandlers.RegisterRoutes(engine)
				apiKeyHandlers.RegisterRoutes(engine)
				usageHandlers.RegisterRoutes(engine)
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
