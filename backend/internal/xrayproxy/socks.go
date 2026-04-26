package xrayproxy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	stdnet "net"
	"net/url"
	"strconv"
	"strings"
	"sync"

	_ "github.com/xtls/xray-core/app/proxyman/inbound"
	_ "github.com/xtls/xray-core/app/proxyman/outbound"
	"github.com/xtls/xray-core/core"
	_ "github.com/xtls/xray-core/main/json"
)

const DefaultSOCKS5Addr = "127.0.0.1:18317"

type SOCKS5Server struct {
	instance *core.Instance
	addr     string
	close    sync.Once
}

func StartSOCKS5(ctx context.Context, listenAddr string, upstreamURL ...string) (*SOCKS5Server, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	addr, err := normalizeListenAddr(listenAddr)
	if err != nil {
		return nil, err
	}
	cfgBytes, err := buildXrayConfig(addr, firstString(upstreamURL...))
	if err != nil {
		return nil, err
	}
	cfg, err := core.LoadConfig("json", bytes.NewReader(cfgBytes))
	if err != nil {
		return nil, fmt.Errorf("load xray socks5 config: %w", err)
	}

	instance, err := core.NewWithContext(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create xray socks5 instance: %w", err)
	}
	if err := instance.Start(); err != nil {
		_ = instance.Close()
		return nil, fmt.Errorf("start xray socks5 listener %s: %w", addr, err)
	}

	server := &SOCKS5Server{instance: instance, addr: addr}
	go func() {
		<-ctx.Done()
		_ = server.Close()
	}()
	return server, nil
}

func (s *SOCKS5Server) Addr() string {
	if s == nil {
		return ""
	}
	return s.addr
}

func (s *SOCKS5Server) ProxyURL() string {
	if s == nil {
		return ""
	}
	return ProxyURL(s.addr)
}

func (s *SOCKS5Server) Close() error {
	if s == nil || s.instance == nil {
		return nil
	}
	var err error
	s.close.Do(func() {
		err = s.instance.Close()
	})
	return err
}

func ProxyURL(addr string) string {
	host, port, err := splitHostPort(addr)
	if err != nil {
		return ""
	}
	return "socks5://" + stdnet.JoinHostPort(host, strconv.Itoa(port))
}

func normalizeListenAddr(addr string) (string, error) {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		addr = DefaultSOCKS5Addr
	}
	host, portValue, err := stdnet.SplitHostPort(addr)
	if err != nil {
		return "", fmt.Errorf("parse xray socks5 listen address %q: %w", addr, err)
	}
	if strings.TrimSpace(host) == "" {
		host = "127.0.0.1"
	}
	port, err := strconv.Atoi(portValue)
	if err != nil || port < 0 || port > 65535 {
		return "", fmt.Errorf("parse xray socks5 listen port %q", portValue)
	}
	if port != 0 {
		return stdnet.JoinHostPort(host, strconv.Itoa(port)), nil
	}

	listener, err := stdnet.Listen("tcp", stdnet.JoinHostPort(host, "0"))
	if err != nil {
		return "", fmt.Errorf("allocate xray socks5 listen port: %w", err)
	}
	defer listener.Close()
	tcpAddr, ok := listener.Addr().(*stdnet.TCPAddr)
	if !ok {
		return "", fmt.Errorf("allocate xray socks5 listen port: unexpected address %s", listener.Addr())
	}
	return stdnet.JoinHostPort(host, strconv.Itoa(tcpAddr.Port)), nil
}

func splitHostPort(addr string) (string, int, error) {
	host, portValue, err := stdnet.SplitHostPort(strings.TrimSpace(addr))
	if err != nil {
		return "", 0, err
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		return "", 0, err
	}
	return host, port, nil
}

func buildXrayConfig(listenAddr, upstreamURL string) ([]byte, error) {
	host, port, err := splitHostPort(listenAddr)
	if err != nil {
		return nil, err
	}
	outbound, err := buildOutbound(strings.TrimSpace(upstreamURL))
	if err != nil {
		return nil, err
	}
	cfg := map[string]any{
		"log": map[string]any{
			"loglevel": "warning",
		},
		"inbounds": []map[string]any{
			{
				"tag":      "kaizhi-socks5",
				"listen":   host,
				"port":     port,
				"protocol": "socks",
				"settings": map[string]any{
					"auth": "noauth",
					"udp":  false,
					"ip":   host,
				},
			},
		},
		"outbounds": []map[string]any{outbound},
	}
	data, err := json.Marshal(cfg)
	if err != nil {
		return nil, err
	}
	return data, nil
}

func buildOutbound(rawURL string) (map[string]any, error) {
	if rawURL == "" {
		return map[string]any{
			"tag":      "proxy",
			"protocol": "freedom",
			"settings": map[string]any{},
		}, nil
	}

	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("parse KAIZHI_PROXY_URL: %w", err)
	}
	scheme := strings.ToLower(strings.TrimSpace(u.Scheme))
	switch scheme {
	case "vless":
		return buildVLESSOutbound(u)
	case "socks5":
		return buildSOCKSOutbound(u)
	case "http", "https":
		return buildHTTPOutbound(u)
	default:
		return nil, fmt.Errorf("unsupported KAIZHI_PROXY_URL scheme %q; want vless, socks5, http, or https", u.Scheme)
	}
}

func buildSOCKSOutbound(u *url.URL) (map[string]any, error) {
	server, err := proxyServerFromURL(u, defaultProxyPort("socks5"))
	if err != nil {
		return nil, err
	}
	settings := map[string]any{
		"servers": []map[string]any{server},
	}
	return map[string]any{
		"tag":      "proxy",
		"protocol": "socks",
		"settings": settings,
	}, nil
}

func buildHTTPOutbound(u *url.URL) (map[string]any, error) {
	server, err := proxyServerFromURL(u, defaultProxyPort(strings.ToLower(u.Scheme)))
	if err != nil {
		return nil, err
	}
	outbound := map[string]any{
		"tag":      "proxy",
		"protocol": "http",
		"settings": map[string]any{
			"servers": []map[string]any{server},
		},
	}
	if strings.EqualFold(u.Scheme, "https") {
		outbound["streamSettings"] = map[string]any{
			"security": "tls",
			"tlsSettings": map[string]any{
				"serverName": u.Hostname(),
			},
		}
	}
	return outbound, nil
}

func buildVLESSOutbound(u *url.URL) (map[string]any, error) {
	host, port, err := hostPortFromURL(u, "443")
	if err != nil {
		return nil, err
	}
	id := strings.TrimSpace(u.User.Username())
	if id == "" {
		return nil, fmt.Errorf("vless proxy URL must include a user id")
	}

	query := u.Query()
	network := firstNonEmpty(query.Get("type"), "tcp")
	security := firstNonEmpty(query.Get("security"), "none")
	settings := map[string]any{
		"vnext": []map[string]any{
			{
				"address": host,
				"port":    port,
				"users": []map[string]any{
					{
						"id":         id,
						"encryption": firstNonEmpty(query.Get("encryption"), "none"),
					},
				},
			},
		},
	}
	if flow := strings.TrimSpace(query.Get("flow")); flow != "" {
		settings["vnext"].([]map[string]any)[0]["users"].([]map[string]any)[0]["flow"] = flow
	}

	outbound := map[string]any{
		"tag":      "proxy",
		"protocol": "vless",
		"settings": settings,
	}
	streamSettings := map[string]any{
		"network":  network,
		"security": security,
	}
	applyVLESSSecurity(streamSettings, host, query)
	applyVLESSTransport(streamSettings, query)
	outbound["streamSettings"] = streamSettings
	return outbound, nil
}

func applyVLESSSecurity(streamSettings map[string]any, host string, query url.Values) {
	security := strings.ToLower(fmt.Sprint(streamSettings["security"]))
	switch security {
	case "tls":
		tlsSettings := map[string]any{
			"serverName": firstNonEmpty(query.Get("sni"), query.Get("peer"), host),
		}
		if alpn := splitComma(query.Get("alpn")); len(alpn) > 0 {
			tlsSettings["alpn"] = alpn
		}
		if fp := strings.TrimSpace(query.Get("fp")); fp != "" {
			tlsSettings["fingerprint"] = fp
		}
		if parseBool(query.Get("allowInsecure")) {
			tlsSettings["allowInsecure"] = true
		}
		streamSettings["tlsSettings"] = tlsSettings
	case "reality":
		realitySettings := map[string]any{
			"serverName":  firstNonEmpty(query.Get("sni"), query.Get("peer"), host),
			"fingerprint": firstNonEmpty(query.Get("fp"), "chrome"),
			"publicKey":   query.Get("pbk"),
			"shortId":     query.Get("sid"),
			"spiderX":     firstNonEmpty(query.Get("spx"), "/"),
		}
		streamSettings["realitySettings"] = realitySettings
	case "", "none":
		streamSettings["security"] = "none"
	}
}

func applyVLESSTransport(streamSettings map[string]any, query url.Values) {
	network := strings.ToLower(fmt.Sprint(streamSettings["network"]))
	host := firstNonEmpty(query.Get("host"), query.Get("authority"))
	path := query.Get("path")
	switch network {
	case "ws", "websocket":
		settings := map[string]any{}
		if host != "" {
			settings["host"] = host
		}
		if path != "" {
			settings["path"] = path
		}
		streamSettings["wsSettings"] = settings
	case "grpc":
		settings := map[string]any{}
		if serviceName := firstNonEmpty(query.Get("serviceName"), path); serviceName != "" {
			settings["serviceName"] = serviceName
		}
		if authority := firstNonEmpty(query.Get("authority"), query.Get("host")); authority != "" {
			settings["authority"] = authority
		}
		if strings.EqualFold(query.Get("mode"), "multi") {
			settings["multiMode"] = true
		}
		streamSettings["grpcSettings"] = settings
	case "httpupgrade":
		settings := map[string]any{}
		if host != "" {
			settings["host"] = host
		}
		if path != "" {
			settings["path"] = path
		}
		streamSettings["httpupgradeSettings"] = settings
	case "xhttp", "splithttp":
		settings := map[string]any{}
		if host != "" {
			settings["host"] = host
		}
		if path != "" {
			settings["path"] = path
		}
		if mode := strings.TrimSpace(query.Get("mode")); mode != "" {
			settings["mode"] = mode
		}
		streamSettings["xhttpSettings"] = settings
	case "tcp", "raw", "":
		streamSettings["network"] = "tcp"
	}
}

func proxyServerFromURL(u *url.URL, defaultPort string) (map[string]any, error) {
	host, port, err := hostPortFromURL(u, defaultPort)
	if err != nil {
		return nil, err
	}
	server := map[string]any{
		"address": host,
		"port":    port,
	}
	username := u.User.Username()
	password, hasPassword := u.User.Password()
	if username != "" || hasPassword {
		server["users"] = []map[string]any{
			{
				"user": username,
				"pass": password,
			},
		}
	}
	return server, nil
}

func hostPortFromURL(u *url.URL, defaultPort string) (string, int, error) {
	host := strings.TrimSpace(u.Hostname())
	if host == "" {
		return "", 0, fmt.Errorf("proxy URL %q must include a host", u.Scheme)
	}
	portValue := strings.TrimSpace(u.Port())
	if portValue == "" {
		portValue = defaultPort
	}
	port, err := strconv.Atoi(portValue)
	if err != nil || port <= 0 || port > 65535 {
		return "", 0, fmt.Errorf("proxy URL %q has invalid port %q", u.Scheme, portValue)
	}
	return host, port, nil
}

func defaultProxyPort(scheme string) string {
	switch strings.ToLower(scheme) {
	case "http":
		return "80"
	case "https":
		return "443"
	default:
		return "1080"
	}
}

func firstString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func splitComma(value string) []string {
	var out []string
	for _, item := range strings.Split(value, ",") {
		item = strings.TrimSpace(item)
		if item != "" {
			out = append(out, item)
		}
	}
	return out
}

func parseBool(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
