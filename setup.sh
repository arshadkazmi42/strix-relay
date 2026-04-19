#!/usr/bin/env bash
set -euo pipefail

G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; N='\033[0m'
ok()   { printf "${G}[OK]${N} %s\n"   "$1"; }
fail() { printf "${R}[FAIL]${N} %s\n" "$1"; exit 1; }
warn() { printf "${Y}[WARN]${N} %s\n" "$1"; }

OS=$(uname -s); ARCH=$(uname -m)
case "$OS" in Darwin|Linux) ok "OS: $OS ($ARCH)";; *) fail "unsupported OS: $OS";; esac

if [ "${EUID:-$(id -u)}" = "0" ] && [ -n "${SUDO_USER:-}" ]; then
  fail "don't run with sudo — the script invokes sudo only where needed (cloudflared install). Re-run as your normal user: ./setup.sh"
fi

cd "$(dirname "$0")"
changed=false

# --- bun ---
if ! command -v bun >/dev/null 2>&1; then
  changed=true; warn "installing bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
  command -v bun >/dev/null 2>&1 || fail "bun install failed (PATH update did not take effect)"
fi
ok "bun $(bun --version)"

# --- cloudflared ---
if ! command -v cloudflared >/dev/null 2>&1; then
  changed=true; warn "installing cloudflared..."
  tmp=$(mktemp -d)
  if [ "$OS" = "Darwin" ]; then
    if command -v brew >/dev/null 2>&1; then
      brew install cloudflared
    else
      case "$ARCH" in
        arm64)  U=https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz;;
        x86_64) U=https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz;;
        *) fail "unsupported arch: $ARCH";;
      esac
      curl -fsSL "$U" -o "$tmp/c.tgz"
      tar -xzf "$tmp/c.tgz" -C "$tmp"
      if [ -w /usr/local/bin ]; then mv "$tmp/cloudflared" /usr/local/bin/cloudflared
      else sudo mv "$tmp/cloudflared" /usr/local/bin/cloudflared; fi
      chmod +x /usr/local/bin/cloudflared
    fi
  else
    case "$ARCH" in
      aarch64|arm64) U=https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64;;
      x86_64|amd64)  U=https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64;;
      *) fail "unsupported arch: $ARCH";;
    esac
    curl -fsSL "$U" -o "$tmp/cloudflared"
    chmod +x "$tmp/cloudflared"
    if [ -w /usr/local/bin ]; then mv "$tmp/cloudflared" /usr/local/bin/cloudflared
    elif command -v sudo >/dev/null 2>&1; then sudo mv "$tmp/cloudflared" /usr/local/bin/cloudflared
    else
      mkdir -p "$HOME/.local/bin"
      mv "$tmp/cloudflared" "$HOME/.local/bin/cloudflared"
      warn "installed to ~/.local/bin — add it to PATH"
      export PATH="$HOME/.local/bin:$PATH"
    fi
  fi
  command -v cloudflared >/dev/null 2>&1 || fail "cloudflared install failed"
fi
ok "cloudflared present"

# --- token ---
if [ ! -f ./.token ]; then
  changed=true
  openssl rand -hex 16 > .token
  chmod 600 .token
  ok "generated .token"
else
  ok ".token present"
fi

# --- icon (1x1 placeholder PNG so load-unpacked works) ---
if [ ! -f ext/icon128.png ]; then
  changed=true
  mkdir -p ext
  printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' \
    | openssl base64 -d -A > ext/icon128.png
  ok "generated ext/icon128.png"
fi

if ! $changed; then echo "Already set up"; exit 0; fi
printf '\nSetup complete.\nToken written to .token\nNext: ./start.sh\n'
