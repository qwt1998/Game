#!/usr/bin/env bash
# 跑单王排行榜：一键安装（Ubuntu 22.04 / 24.04，用 root 账号运行）
#
#   curl -fsSL https://qwt1998.github.io/Game/server/install.sh | bash
#
# 没有域名时，自动用 "IP 地址.sslip.io" 当网址（免费，不用注册）。
# 有自己的域名（已经指向这台服务器）时，把域名接在最后：
#   curl -fsSL https://qwt1998.github.io/Game/server/install.sh | bash -s 你的域名
#
# 再运行一次就是更新到仓库里的最新版，成绩不会丢。
# Caddy 负责加密连接（https）和自动续证书；排行榜程序只在本机 8787 端口上，不直接对外。

set -euo pipefail

SRC=https://qwt1998.github.io/Game/server

say(){ printf '\n\033[1;33m== %s\033[0m\n' "$*"; }
fail(){ printf '\n\033[1;31m!! %s\033[0m\n' "$*" >&2; exit 1; }

# Everything sits in main() so bash reads the whole script before running any of it
# (it arrives through a pipe, and apt would otherwise eat the rest of it).
main(){
  [ "$(id -u)" = 0 ] || fail "要用 root 账号运行（或者在命令最前面加 sudo）"
  command -v apt-get >/dev/null || fail "这个脚本只支持 Ubuntu / Debian 系统"

  local host="${1:-}" ip=""
  if [ -z "$host" ]; then
    ip=$(curl -4 -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)
    if ! [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      ip=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$' \
           | grep -Ev '^(10|127)\.|^192\.168\.|^172\.(1[6-9]|2[0-9]|3[01])\.' | head -n1 || true)
    fi
    [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "找不到这台服务器的公网 IP"
    host="${ip//./-}.sslip.io"
  fi

  say "检查 80 和 443 端口有没有被别的程序占着"
  local p line
  for p in 80 443; do
    line=$(ss -ltnpH "sport = :$p" 2>/dev/null | head -n1 || true)
    if [ -n "$line" ] && ! grep -q caddy <<<"$line"; then
      fail "端口 $p 已经被别的程序占用，先别继续。把这一行发给 Claude：$line"
    fi
  done

  say "安装需要的软件：Caddy（加密连接）和 Python"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq </dev/null
  apt-get install -y -qq caddy python3 curl </dev/null >/dev/null

  say "下载排行榜程序"
  id paodan >/dev/null 2>&1 || useradd --system --home-dir /var/lib/paodan --shell /usr/sbin/nologin paodan
  install -d -o paodan -g paodan -m 750 /var/lib/paodan
  install -d -m 755 /opt/paodan
  curl -fsSL "$SRC/leaderboard.py" -o /opt/paodan/leaderboard.py.new
  python3 -c "import ast,sys;ast.parse(open(sys.argv[1]).read())" /opt/paodan/leaderboard.py.new \
    || fail "下载的程序不完整，过一会儿再运行一次"
  mv /opt/paodan/leaderboard.py.new /opt/paodan/leaderboard.py
  chmod 644 /opt/paodan/leaderboard.py

  cat >/etc/systemd/system/paodan.service <<'UNIT'
[Unit]
Description=跑单王排行榜
After=network.target

[Service]
User=paodan
Group=paodan
Environment=PAODAN_DB=/var/lib/paodan/scores.db
ExecStart=/usr/bin/python3 -I /opt/paodan/leaderboard.py serve
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/paodan

[Install]
WantedBy=multi-user.target
UNIT

  # admin shortcut: paodan list / paodan hide 名字 / paodan unhide 名字
  cat >/usr/local/bin/paodan <<'CMD'
#!/bin/sh
exec runuser -u paodan -- env PAODAN_DB=/var/lib/paodan/scores.db python3 -I /opt/paodan/leaderboard.py "$@"
CMD
  chmod 755 /usr/local/bin/paodan

  say "设置网址：https://$host"
  if [ -f /etc/caddy/Caddyfile ] && ! grep -q '跑单王排行榜' /etc/caddy/Caddyfile; then
    cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%Y%m%d%H%M%S)"
  fi
  cat >/etc/caddy/Caddyfile <<CADDY
# 跑单王排行榜（由 install.sh 生成，再运行一次 install.sh 会覆盖）
$host {
	encode gzip
	reverse_proxy 127.0.0.1:8787
}
CADDY

  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
  fi

  systemctl daemon-reload
  systemctl enable paodan caddy >/dev/null 2>&1
  systemctl restart paodan
  systemctl restart caddy

  say "等加密证书（第一次大约要半分钟到一分钟）"
  local i
  for i in $(seq 1 40); do
    if curl -fsS --max-time 5 "https://$host/api/ping" >/dev/null 2>&1; then
      printf '\n\033[1;32m装好了！把下面这一行发给 Claude：\033[0m\n\n    排行榜地址 https://%s\n\n' "$host"
      printf '再用手机流量（不开代理）打开这个测试地址，看到 "ok": true 就说明国内能连上：\n\n    https://%s/api/ping\n\n' "$host"
      printf '以后管理排行榜：paodan list 看前 50 名；paodan hide 名字 藏起造假的成绩；paodan unhide 名字 恢复。\n'
      return 0
    fi
    sleep 3
  done

  printf '\n\033[1;31m排行榜程序装好了，但外面还连不上 https://%s\033[0m\n' "$host" >&2
  printf '最常见的原因：Vultr 后台给这台服务器开了防火墙（Firewall），没放行 80 和 443 端口。\n' >&2
  printf '放行以后，再运行一次同样的安装命令就行。还不行的话，把下面这几行发给 Claude：\n\n' >&2
  systemctl is-active paodan caddy >&2 || true
  journalctl -u caddy -n 12 --no-pager 2>/dev/null | tail -n 12 >&2 || true
  exit 1
}

main "$@"
