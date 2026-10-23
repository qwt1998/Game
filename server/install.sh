#!/usr/bin/env bash
# 跑单王排行榜、对战和游戏本身：一键安装（Ubuntu 22.04 / 24.04，用 root 账号运行）
#
#   curl -fsSL https://qwt1998.github.io/Game/server/install.sh | bash
#
# 没有域名时，自动用 "IP 地址.sslip.io" 当网址（免费，不用注册）。
# 有自己的域名（已经指向这台服务器）时，把域名接在最后：
#   curl -fsSL https://qwt1998.github.io/Game/server/install.sh | bash -s 你的域名
#
# 再运行一次就是更新到仓库里的最新版，成绩不会丢。
# Caddy 负责加密连接（https）和自动续证书；排行榜程序只在本机 8787 端口上，
# 对战程序只在本机 8788 端口上（网址里的 /vs 转给它），都不直接对外。
# 游戏本身也放一份在这台服务器上（每 10 分钟从 GitHub 同步一次），国内连不上 GitHub 的手机打开 https://网址/ 就能玩。

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

  say "下载排行榜和对战程序"
  id paodan >/dev/null 2>&1 || useradd --system --home-dir /var/lib/paodan --shell /usr/sbin/nologin paodan
  install -d -o paodan -g paodan -m 750 /var/lib/paodan
  install -d -m 755 /opt/paodan
  local f
  for f in leaderboard.py versus.py; do
    curl -fsSL "$SRC/$f" -o "/opt/paodan/$f.new"
    python3 -c "import ast,sys;ast.parse(open(sys.argv[1]).read())" "/opt/paodan/$f.new" \
      || fail "下载的程序不完整，过一会儿再运行一次"
  done
  curl -fsSL "$SRC/sync-site.sh" -o /opt/paodan/sync-site.sh.new
  sh -n /opt/paodan/sync-site.sh.new || fail "下载的程序不完整，过一会儿再运行一次"
  for f in leaderboard.py versus.py sync-site.sh; do
    mv "/opt/paodan/$f.new" "/opt/paodan/$f"
    chmod 644 "/opt/paodan/$f"
  done
  # the copy of the game this server hands out; Caddy reads it, the sync job (as paodan) rewrites it
  install -d -o paodan -g paodan -m 755 /srv/paodan

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

  cat >/etc/systemd/system/paodan-vs.service <<'UNIT'
[Unit]
Description=跑单王对战
After=network.target

[Service]
User=paodan
Group=paodan
ExecStart=/usr/bin/python3 -I /opt/paodan/versus.py
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

  cat >/etc/systemd/system/paodan-site.service <<'UNIT'
[Unit]
Description=跑单王：从 GitHub 同步游戏文件
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=paodan
Group=paodan
ExecStart=/bin/sh /opt/paodan/sync-site.sh
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/srv/paodan
UNIT

  cat >/etc/systemd/system/paodan-site.timer <<'UNIT'
[Unit]
Description=跑单王：每 10 分钟同步一次游戏文件

[Timer]
OnBootSec=1min
OnUnitActiveSec=10min
Persistent=true

[Install]
WantedBy=timers.target
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
# 跑单王排行榜、对战和游戏（由 install.sh 生成，再运行一次 install.sh 会覆盖）
$host {
	handle /vs* {
		reverse_proxy 127.0.0.1:8788
	}
	handle /api/* {
		encode gzip
		reverse_proxy 127.0.0.1:8787
	}
	handle {
		encode gzip
		header Cache-Control "no-cache"
		@manifest path /manifest.webmanifest
		header @manifest Content-Type "application/manifest+json"
		root * /srv/paodan/site
		file_server
	}
}
CADDY

  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
  fi

  systemctl daemon-reload
  systemctl enable paodan paodan-vs caddy >/dev/null 2>&1
  systemctl enable --now paodan-site.timer >/dev/null 2>&1
  systemctl restart paodan paodan-vs
  say "把游戏放到这台服务器上"
  systemctl start paodan-site || printf '\033[1;33m游戏文件这次没下载成功，10 分钟后会自动再试\033[0m\n'
  systemctl restart caddy

  say "等加密证书（第一次大约要半分钟到一分钟）"
  local i
  for i in $(seq 1 40); do
    if curl -fsS --max-time 5 "https://$host/api/ping" >/dev/null 2>&1 && curl -fsS --max-time 5 "https://$host/vs/ping" >/dev/null 2>&1; then
      printf '\n\033[1;32m装好了！把下面这一行发给 Claude：\033[0m\n\n    排行榜地址 https://%s\n\n' "$host"
      printf '再用手机流量（不开代理）打开这个测试地址，看到 "ok": true 就说明国内能连上：\n\n    https://%s/api/ping\n\n' "$host"
      printf '对战也装好了，检查地址：https://%s/vs/ping\n\n' "$host"
      local page
      page=$(curl -fsS --max-time 10 "https://$host/" 2>/dev/null || true)
      if grep -q '跑单王' <<<"$page"; then
        printf '\033[1;32m游戏也放好了\033[0m，国内手机打不开 GitHub 时用这个地址玩（以后每 10 分钟自动更新）：\n\n    https://%s/\n\n' "$host"
      fi
      printf '以后管理排行榜：paodan list 看前 50 名；paodan hide 名字 藏起造假的成绩；paodan unhide 名字 恢复。\n'
      return 0
    fi
    sleep 3
  done

  printf '\n\033[1;31m排行榜程序装好了，但外面还连不上 https://%s\033[0m\n' "$host" >&2
  printf '最常见的原因：Vultr 后台给这台服务器开了防火墙（Firewall），没放行 80 和 443 端口。\n' >&2
  printf '放行以后，再运行一次同样的安装命令就行。还不行的话，把下面这几行发给 Claude：\n\n' >&2
  systemctl is-active paodan paodan-vs paodan-site.timer caddy >&2 || true
  journalctl -u caddy -n 12 --no-pager 2>/dev/null | tail -n 12 >&2 || true
  exit 1
}

main "$@"
