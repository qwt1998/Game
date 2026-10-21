#!/usr/bin/env python3
"""跑单王排行榜：一个很小的网页服务，只用 Python 自带的功能，不用装别的东西。

游戏每跑完一局，就把这个骑手的累计成绩发过来（/api/sync）；
排行榜页面来取前 20 名和"我排第几"（/api/top）。
成绩存在一个 SQLite 文件里（默认 /var/lib/paodan/scores.db）。

在服务器上管理（install.sh 装好的 paodan 命令会调用这里）：
  paodan list          看前 50 名，带编号
  paodan hide 名字      把某人从榜上藏起来（名字或编号都行），比如明显造假的成绩
  paodan unhide 名字    恢复
"""
import json
import os
import re
import sqlite3
import sys
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DB = os.environ.get('PAODAN_DB', '/var/lib/paodan/scores.db')
PORT = int(os.environ.get('PAODAN_PORT', '8787'))
TOP = 20

# A real run (150 game minutes, every order under ¥20) can't get near MAX_BEST.
# Anything subtler is left to the owner: `paodan hide 名字` takes a fake score off the board.
MAX_BEST = 1000
MAX_GAMES = 100000
RIDER_GAP = 15       # seconds between two syncs from the same rider
IP_PER_HOUR = 240    # syncs per hour from one address (a whole office on one Wi-Fi still fits)

ID_RE = re.compile(r'^[a-z0-9]{6,16}$')
write_lock = threading.Lock()
recent_rider = {}
recent_ip = {}


@contextmanager
def db():
    """One connection per request: commits on success, always closes."""
    con = sqlite3.connect(DB, timeout=10)
    con.row_factory = sqlite3.Row
    try:
        with con:
            yield con
    finally:
        con.close()


def setup():
    with db() as con:
        con.execute('''CREATE TABLE IF NOT EXISTS riders(
            id TEXT PRIMARY KEY, name TEXT NOT NULL, best REAL NOT NULL DEFAULT 0,
            games INTEGER NOT NULL DEFAULT 0, income REAL NOT NULL DEFAULT 0,
            delivered INTEGER NOT NULL DEFAULT 0, on_time INTEGER NOT NULL DEFAULT 0,
            updated INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0)''')
        con.execute('CREATE INDEX IF NOT EXISTS riders_best ON riders(hidden, best DESC, updated)')


def clean_name(v):
    s = ''.join(ch for ch in str(v or '') if ch.isprintable()).strip()
    return s[:12]


def num(v, lo, hi, whole=False):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise ValueError
    if v != v or v < lo or v > hi:
        raise ValueError
    return int(v) if whole else round(float(v), 1)


def check(body):
    rid = str(body.get('id', ''))
    name = clean_name(body.get('name'))
    if not ID_RE.match(rid) or not name:
        raise ValueError
    best = num(body.get('best', 0), 0, MAX_BEST)
    games = num(body.get('games', 0), 1, MAX_GAMES, True)
    delivered = num(body.get('delivered', 0), 0, games * 80, True)
    on_time = num(body.get('onTime', 0), 0, delivered, True)
    income = num(body.get('income', 0), -games * 500, games * MAX_BEST)
    return rid, name, best, games, income, delivered, on_time


def too_often(rid, ip, now):
    if now - recent_rider.get(rid, 0) < RIDER_GAP:
        return True
    hits = [t for t in recent_ip.get(ip, []) if now - t < 3600]
    if len(hits) >= IP_PER_HOUR:
        recent_ip[ip] = hits
        return True
    hits.append(now)
    recent_ip[ip] = hits
    recent_rider[rid] = now
    if len(recent_rider) > 50000:
        recent_rider.clear()
    if len(recent_ip) > 50000:
        recent_ip.clear()
    return False


def rank_of(con, rid):
    me = con.execute('SELECT name, best, updated, hidden FROM riders WHERE id=?', (rid,)).fetchone()
    if not me or me['hidden'] or me['best'] <= 0:
        return None
    ahead = con.execute('SELECT COUNT(*) FROM riders WHERE hidden=0 AND best>0 AND (best>? OR (best=? AND updated<?))',
                        (me['best'], me['best'], me['updated'])).fetchone()[0]
    return {'rank': ahead + 1, 'name': me['name'], 'best': me['best']}


def total(con):
    return con.execute('SELECT COUNT(*) FROM riders WHERE hidden=0 AND best>0').fetchone()[0]


def sync(body, ip):
    rid, name, best, games, income, delivered, on_time = check(body)
    now = time.time()
    with write_lock:
        if too_often(rid, ip, now):
            return 429, {'error': '太频繁了，等一会儿再试'}
        with db() as con:
            old = con.execute('SELECT best, updated FROM riders WHERE id=?', (rid,)).fetchone()
            # 'updated' is when the best was set, so on a tie whoever got there first ranks higher
            stamp = int(now) if not old or best > old['best'] else old['updated']
            con.execute('''INSERT INTO riders(id, name, best, games, income, delivered, on_time, updated)
                VALUES(?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET name=excluded.name, best=MAX(best, excluded.best),
                  games=MAX(games, excluded.games), income=excluded.income,
                  delivered=MAX(delivered, excluded.delivered), on_time=MAX(on_time, excluded.on_time),
                  updated=?''', (rid, name, best, games, income, delivered, on_time, stamp, stamp))
            return 200, {'ok': True, 'me': rank_of(con, rid), 'total': total(con)}


def top(rid):
    with db() as con:
        rows = con.execute('SELECT id, name, best, games FROM riders WHERE hidden=0 AND best>0 '
                           'ORDER BY best DESC, updated LIMIT ?', (TOP,)).fetchall()
        out = [{'rank': i + 1, 'name': r['name'], 'best': r['best'], 'games': r['games'], 'me': r['id'] == rid}
               for i, r in enumerate(rows)]
        me = rank_of(con, rid) if ID_RE.match(rid or '') else None
        return 200, {'top': out, 'me': me, 'total': total(con)}


class Handler(BaseHTTPRequestHandler):
    server_version = 'paodan'

    def send(self, code, data):
        raw = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.cors()
        self.end_headers()
        self.wfile.write(raw)

    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Max-Age', '86400')

    def client_ip(self):
        fwd = self.headers.get('X-Forwarded-For', '')
        if self.client_address[0] in ('127.0.0.1', '::1') and fwd:
            return fwd.split(',')[0].strip()
        return self.client_address[0]

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/api/top':
            self.send(*top(parse_qs(url.query).get('id', [''])[0]))
        elif url.path == '/api/ping':
            self.send(200, {'ok': True, 'name': '跑单王排行榜'})
        else:
            self.send(404, {'error': '没有这个地址'})

    def do_POST(self):
        if urlparse(self.path).path != '/api/sync':
            return self.send(404, {'error': '没有这个地址'})
        try:
            size = int(self.headers.get('Content-Length') or 0)
            if size <= 0 or size > 2048:
                raise ValueError
            body = json.loads(self.rfile.read(size).decode('utf-8'))
            if not isinstance(body, dict):
                raise ValueError
            self.send(*sync(body, self.client_ip()))
        except (ValueError, UnicodeDecodeError):
            self.send(400, {'error': '成绩格式不对'})

    def log_message(self, fmt, *args):
        pass


def admin(cmd, who):
    with db() as con:
        if cmd == 'list':
            rows = con.execute('SELECT id, name, best, games, hidden FROM riders ORDER BY best DESC LIMIT 50').fetchall()
            for i, r in enumerate(rows, 1):
                print(f"{i:>3}. {r['name']:<12} 最好 ¥{r['best']:<7} {r['games']:>4} 局  编号 {r['id']}" + ('  （已藏起来）' if r['hidden'] else ''))
            print(f'榜上一共 {total(con)} 人')
            return
        hit = con.execute('UPDATE riders SET hidden=? WHERE id=? OR name=?', (1 if cmd == 'hide' else 0, who, who)).rowcount
        print(f'{"藏起来" if cmd == "hide" else "恢复"}了 {hit} 个骑手' if hit else '没找到这个名字或编号，先用 paodan list 看看')


def main():
    setup()
    args = sys.argv[1:] or ['serve']
    if args[0] == 'serve':
        srv = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
        srv.daemon_threads = True
        print(f'跑单王排行榜在 127.0.0.1:{PORT} 上运行，成绩存在 {DB}', flush=True)
        srv.serve_forever()
    elif args[0] == 'list':
        admin('list', None)
    elif args[0] in ('hide', 'unhide') and len(args) > 1:
        admin(args[0], ' '.join(args[1:]))
    else:
        print(__doc__)


if __name__ == '__main__':
    main()
