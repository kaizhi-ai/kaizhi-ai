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
	"github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy"
	"github.com/router-for-me/CLIProxyAPI/v6/sdk/config"
	"kaizhi/backend/internal/apikeys"
	"kaizhi/backend/internal/chats"
	"kaizhi/backend/internal/postgres"
	appusage "kaizhi/backend/internal/usage"
	"kaizhi/backend/internal/users"
	"kaizhi/backend/web"
)

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

	db, err := postgres.Open(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatalf("connect postgres: %v", err)
	}
	defer db.Close()

	if err := postgres.EnsureSchema(ctx, db); err != nil {
		log.Fatalf("ensure postgres schema: %v", err)
	}
	userStore := users.NewStore(db)
	apiKeyStore := apikeys.NewStore(db)
	usageStore := appusage.NewStore(db)
	chatStore := chats.NewStore(db)

	tokenService, err := users.NewTokenService(os.Getenv("JWT_SECRET"))
	if err != nil {
		log.Fatalf("configure token service: %v", err)
	}

	apiKeyService, err := apikeys.NewService(apiKeyStore, os.Getenv("API_KEY_PEPPER"))
	if err != nil {
		log.Fatalf("configure api key service: %v", err)
	}

	access.RegisterProvider("kaizhi-api-key", apikeys.NewAccessProvider(apiKeyService))
	userHandlers := users.NewHandlers(userStore, tokenService)
	apiKeyHandlers := apikeys.NewHandlers(apiKeyStore, apiKeyService, userStore, tokenService)
	usageHandlers := appusage.NewHandlers(usageStore, userStore, tokenService)
	chatHandlers := chats.NewHandlers(chatStore, userStore, tokenService)

	cfg, err := config.LoadConfig(absConfigPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	svc, err := cliproxy.NewBuilder().
		WithConfig(cfg).
		WithConfigPath(absConfigPath).
		WithServerOptions(
			api.WithMiddleware(web.SPAMiddleware()),
			api.WithRouterConfigurator(func(engine *gin.Engine, _ *handlers.BaseAPIHandler, _ *config.Config) {
				userHandlers.RegisterRoutes(engine)
				apiKeyHandlers.RegisterRoutes(engine)
				usageHandlers.RegisterRoutes(engine)
				chatHandlers.RegisterRoutes(engine)
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
