#!/bin/sh
# 跑单王：把 GitHub 上最新的游戏文件同步到这台服务器，国内连不上 GitHub 的手机从这里玩。
# install.sh 装好后每 10 分钟自动跑一次（paodan-site.timer），也可以手动跑：
#   systemctl start paodan-site
# 先全部下载到一个临时文件夹，检查无误再整体换上，下载到一半失败不会弄坏正在用的那份。
set -eu
SRC=${PAODAN_SITE_SRC:-https://qwt1998.github.io/Game}
BASE=${PAODAN_SITE_BASE:-/srv/paodan}
DST=$BASE/site
TMP=$(mktemp -d "$BASE/site.new.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

curl -fsSL --max-time 30 "$SRC/server/site-files.txt?t=$(date +%s)" -o "$TMP/.list"
while IFS= read -r f; do
  case "$f" in ''|'#'*) continue ;; esac
  case "$f" in *..*|/*|*' '*) echo "跳过不安全的文件名：$f" >&2; continue ;; esac
  mkdir -p "$TMP/$(dirname "$f")"
  curl -fsSL --max-time 60 "$SRC/$f?t=$(date +%s)" -o "$TMP/$f"
done < "$TMP/.list"
rm -f "$TMP/.list"

# the page has to be complete, or keep the copy we have
grep -q '</html>' "$TMP/index.html"
chmod -R a+rX "$TMP"

rm -rf "$DST.old"
if [ -d "$DST" ]; then mv "$DST" "$DST.old"; fi
mv "$TMP" "$DST"
trap - EXIT
rm -rf "$DST.old"
