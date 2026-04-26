package xrayproxy

import (
	"bytes"
	"context"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/xtls/xray-core/core"
	"golang.org/x/net/proxy"
)

func TestStartSOCKS5ForwardsTCP(t *testing.T) {
	upstream, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen upstream: %v", err)
	}
	defer upstream.Close()

	done := make(chan error, 1)
	go func() {
		conn, err := upstream.Accept()
		if err != nil {
			done <- err
			return
		}
		defer conn.Close()
		if _, err := io.Copy(conn, conn); err != nil {
			done <- err
			return
		}
		done <- nil
	}()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := StartSOCKS5(ctx, "127.0.0.1:0")
	if err != nil {
		t.Fatalf("start socks5: %v", err)
	}
	defer server.Close()

	dialer, err := proxy.SOCKS5("tcp", server.Addr(), nil, proxy.Direct)
	if err != nil {
		t.Fatalf("create socks5 dialer: %v", err)
	}
	conn, err := dialer.Dial("tcp", upstream.Addr().String())
	if err != nil {
		t.Fatalf("dial through socks5: %v", err)
	}
	defer conn.Close()
	if err := conn.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set deadline: %v", err)
	}
	if _, err := conn.Write([]byte("ping")); err != nil {
		t.Fatalf("write through socks5: %v", err)
	}
	buf := make([]byte, 4)
	if _, err := io.ReadFull(conn, buf); err != nil {
		t.Fatalf("read through socks5: %v", err)
	}
	if string(buf) != "ping" {
		t.Fatalf("echo = %q, want ping", string(buf))
	}

	_ = conn.Close()
	select {
	case err := <-done:
		if err != nil && !isClosedNetworkError(err) {
			t.Fatalf("upstream error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("upstream did not finish")
	}
}

func TestProxyURL(t *testing.T) {
	if got, want := ProxyURL("127.0.0.1:18317"), "socks5://127.0.0.1:18317"; got != want {
		t.Fatalf("ProxyURL() = %q, want %q", got, want)
	}
	if got, want := ProxyURL("[::1]:18317"), "socks5://[::1]:18317"; got != want {
		t.Fatalf("ProxyURL() = %q, want %q", got, want)
	}
}

func TestBuildXrayConfigSupportsProxyURLSchemes(t *testing.T) {
	tests := []string{
		"",
		"socks5://user:pass@127.0.0.1:1080",
		"http://user:pass@proxy.example:8080",
		"https://proxy.example",
		"vless://00000000-0000-0000-0000-000000000000@example.com:443?security=tls&type=ws&sni=example.com&fp=chrome&path=%2Fws&host=example.com",
	}
	for _, upstreamURL := range tests {
		t.Run(upstreamURL, func(t *testing.T) {
			data, err := buildXrayConfig("127.0.0.1:18317", upstreamURL)
			if err != nil {
				t.Fatalf("build config: %v", err)
			}
			if _, err := core.LoadConfig("json", bytes.NewReader(data)); err != nil {
				t.Fatalf("load config: %v\n%s", err, data)
			}
		})
	}
}

func TestBuildXrayConfigRejectsUnsupportedProxyURLScheme(t *testing.T) {
	if _, err := buildXrayConfig("127.0.0.1:18317", "ftp://proxy.example:21"); err == nil {
		t.Fatal("build config succeeded, want unsupported scheme error")
	}
}

func isClosedNetworkError(err error) bool {
	if err == nil {
		return false
	}
	networkErr, ok := err.(*net.OpError)
	return ok && strings.Contains(networkErr.Err.Error(), "closed")
}
