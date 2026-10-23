#!/usr/bin/env python3
"""跑单王对战：两个人各用各的手机同时跑一局，这个小程序在两部手机之间传话。

只用 Python 自带的功能，不用装别的东西。什么都不存盘，房间都放在内存里，
程序重启就清空（正在进行的对战会断开，单人模式和排行榜不受影响）。

Caddy 把 https://网址/vs 转到这里（本机 8788 端口，不直接对外）：
  /vs/ping   检查程序在不在；游戏靠它决定显不显示"和朋友对战"按钮
  /vs        WebSocket（一种一直连着的网页连接）：开房间、加入、准备、开跑、互相转发位置

两部手机各算各的城市，这里只做三件事：配对、定好同时开跑的时刻、把一方的位置和收入转给另一方。
配对靠房间号：一个人开房间，朋友输入房间号申请加入，房主点"同意"才进得来。
"""
import asyncio
import base64
import hashlib
import json
import os
import random
import secrets
import struct
import time

HOST = os.environ.get('PAODAN_VS_HOST', '127.0.0.1')
PORT = int(os.environ.get('PAODAN_VS_PORT', '8788'))

MAX_ROOMS = 500
MAX_CONN_PER_IP = 12      # a household or office on one Wi-Fi still fits
ROOMS_PER_IP_HOUR = 40
MAX_MSG = 2048            # bytes in one message; the game's messages are well under 300
MSG_PER_SEC = 40          # the game sends about 8 a second; far more than that and the phone is cut off
IDLE = 45                 # seconds without hearing from a phone before it counts as gone
SEAT_HOLD = 30            # seconds a dropped player can come back into the same game
ROOM_LIFE = 3 * 3600      # rooms are cleared out after this long whatever happens
COUNTDOWN = 3.5           # seconds from "both ready" to the start, so both phones can count down together
ASK_WAIT = int(os.environ.get('PAODAN_VS_ASK_WAIT', '60'))   # seconds the room owner has to answer a join request
DIRS = ('up', 'down', 'left', 'right')
HALTS = ('', 'crash', 'police', 'swap', 'repair')

WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
rooms = {}
conns_per_ip = {}
created_per_ip = {}


def now_ms():
    return int(time.time() * 1000)


def clean_name(v):
    s = ''.join(ch for ch in str(v or '') if ch.isprintable()).strip()
    return s[:12] or '骑手'


def num(v, lo, hi, default=0.0):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
        return default
    return min(hi, max(lo, v))


class Closed(Exception):
    pass


class Conn:
    """One phone's WebSocket connection."""

    def __init__(self, reader, writer, ip):
        self.reader, self.writer, self.ip = reader, writer, ip
        self.player = None
        self.room = None
        self.asking = None      # the room this phone has asked to join, while it waits for the owner's answer
        self.seen = time.time()
        self.window = (0, 0)   # (second, messages in it)
        self.open = True

    def send(self, obj):
        if not self.open:
            return
        raw = json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        self.write_frame(0x1, raw)

    def write_frame(self, op, payload):
        n = len(payload)
        if n < 126:
            head = bytes([0x80 | op, n])
        elif n < 65536:
            head = bytes([0x80 | op, 126]) + struct.pack('!H', n)
        else:
            head = bytes([0x80 | op, 127]) + struct.pack('!Q', n)
        try:
            self.writer.write(head + payload)
            # a phone that stopped reading: drop it instead of piling up messages for it
            if self.writer.transport.get_write_buffer_size() > 256 * 1024:
                self.close()
        except Exception:
            self.close()

    def close(self):
        if self.open:
            self.open = False
            try:
                self.writer.close()
            except Exception:
                pass

    async def read_message(self):
        """The next text message, answering pings along the way."""
        parts, total = [], 0
        while True:
            h = await self.reader.readexactly(2)
            fin, op, masked, n = h[0] & 0x80, h[0] & 0x0F, h[1] & 0x80, h[1] & 0x7F
            if n == 126:
                n = struct.unpack('!H', await self.reader.readexactly(2))[0]
            elif n == 127:
                n = struct.unpack('!Q', await self.reader.readexactly(8))[0]
            if n > MAX_MSG or not masked:
                raise Closed
            mask = await self.reader.readexactly(4)
            data = await self.reader.readexactly(n)
            if n:
                data = (int.from_bytes(data, 'big') ^ int.from_bytes((mask * (n // 4 + 1))[:n], 'big')).to_bytes(n, 'big')
            self.seen = time.time()
            if op == 0x8:
                self.write_frame(0x8, b'')
                raise Closed
            if op == 0x9:
                self.write_frame(0xA, data)
                continue
            if op == 0xA:
                continue
            if op not in (0x0, 0x1, 0x2):
                raise Closed
            total += n
            if total > MAX_MSG:
                raise Closed
            parts.append(data)
            if fin:
                return b''.join(parts)


class Player:
    def __init__(self, name):
        self.name = name
        self.token = secrets.token_hex(8)
        self.conn = None
        self.ready = False
        self.gone_at = None     # when the connection dropped during a game
        self.finished = False


class Room:
    def __init__(self, code, ver):
        self.code, self.ver = code, ver
        self.players = []
        self.created = time.time()
        self.start_at = None    # server time (ms) the current game starts, while one is on
        self.seed = 0
        self.ask = None         # the one join request waiting for the owner: {'conn', 'name', 'at'}

    def other(self, p):
        return next((q for q in self.players if q is not p), None)

    def state_for(self, p):
        return {'t': 'room', 'code': self.code, 'you': self.players.index(p), 'token': p.token,
                'playing': self.start_at is not None,
                'ask': self.ask['name'] if self.ask and p is self.players[0] else None,
                'players': [{'name': q.name, 'ready': q.ready, 'here': q.conn is not None} for q in self.players]}

    def tell_all(self):
        for q in self.players:
            if q.conn:
                q.conn.send(self.state_for(q))

    def tell_other(self, p, obj):
        q = self.other(p)
        if q and q.conn:
            q.conn.send(obj)


def new_code():
    for _ in range(200):
        code = str(random.randint(1000, 9999))
        if code not in rooms:
            return code
    return None


def end_ask(room, why=None):
    """Clears the room's join request, telling the person who asked why (code, message) if they are still waiting."""
    ask, room.ask = room.ask, None
    if ask and ask['conn'].asking is room:
        ask['conn'].asking = None
        if why:
            ask['conn'].send({'t': 'error', 'code': why[0], 'msg': why[1]})


def cancel_ask(conn):
    """The phone stops waiting for an answer (it gave up, asked somewhere else or went away)."""
    room = conn.asking
    conn.asking = None
    if room and room.ask and room.ask['conn'] is conn:
        room.ask = None
        room.tell_all()


def leave(conn, quiet=False):
    """The phone leaves its room for good (or its seat timed out)."""
    room, p = conn.room, conn.player
    conn.room = conn.player = None
    if not room or p not in room.players:
        return
    if p.conn is conn:
        p.conn = None
    drop(room, p, quiet)


def drop(room, p, quiet=False):
    room.players.remove(p)
    if not quiet:
        room.tell_other(p, {'t': 'left', 'name': p.name})
    if not room.players:
        end_ask(room, ('gone', '房主离开了，房间没了'))
        rooms.pop(room.code, None)
        return
    if room.start_at is not None and all(q.finished for q in room.players):
        room.start_at = None
    for q in room.players:
        q.ready = False
    room.tell_all()


def seat(conn, room, p):
    conn.room, conn.player, p.conn, p.gone_at = room, p, conn, None


def handle(conn, msg):
    t = msg.get('t')
    room, p = conn.room, conn.player
    if t == 'ping':
        conn.send({'t': 'pong', 'c': num(msg.get('c'), 0, 1e16), 's': now_ms()})
    elif t == 'create':
        cancel_ask(conn)
        leave(conn)
        hour_ago = time.time() - 3600
        made = [x for x in created_per_ip.get(conn.ip, []) if x > hour_ago]
        code = new_code() if len(rooms) < MAX_ROOMS and len(made) < ROOMS_PER_IP_HOUR else None
        if not code:
            return conn.send({'t': 'error', 'code': 'busy', 'msg': '开房间太频繁了，等一会儿再试'})
        made.append(time.time())
        created_per_ip[conn.ip] = made
        room = rooms[code] = Room(code, str(msg.get('v', ''))[:20])
        p = Player(clean_name(msg.get('name')))
        room.players.append(p)
        seat(conn, room, p)
        room.tell_all()
    elif t == 'join':
        code = str(msg.get('code', ''))[:8]
        room = rooms.get(code)
        if not room:
            return conn.send({'t': 'error', 'code': 'none', 'msg': '没有这个房间，看看房间号对不对'})
        if room is conn.room:
            return room.tell_all()
        if room.ver != str(msg.get('v', ''))[:20]:
            return conn.send({'t': 'error', 'code': 'version', 'msg': '你们俩的游戏版本不一样，两边都刷新一下页面再试'})
        if len(room.players) >= 2:
            return conn.send({'t': 'error', 'code': 'full', 'msg': '这个房间已经有两个人了'})
        if room.start_at is not None:
            return conn.send({'t': 'error', 'code': 'busy', 'msg': '这个房间正在比赛，等这局跑完再进'})
        if room.ask and room.ask['conn'] is not conn and room.ask['conn'].open:
            return conn.send({'t': 'error', 'code': 'busy', 'msg': '房主正在处理别人的加入申请，等一会儿再试'})
        # nobody gets in on the number alone: the owner is asked first
        if conn.asking is not room:
            cancel_ask(conn)
        leave(conn)
        room.ask = {'conn': conn, 'name': clean_name(msg.get('name')), 'at': time.time()}
        conn.asking = room
        conn.send({'t': 'wait', 'code': room.code, 'host': room.players[0].name, 'secs': ASK_WAIT})
        room.tell_all()
    elif t == 'cancel':
        cancel_ask(conn)
    elif t == 'rejoin':
        room = rooms.get(str(msg.get('code', ''))[:8])
        p = next((q for q in room.players if q.token == msg.get('token')), None) if room else None
        if not p:
            return conn.send({'t': 'error', 'code': 'gone', 'msg': '回不到原来的房间了'})
        if p.conn and p.conn is not conn:
            old = p.conn
            old.room = old.player = None
            old.close()
        seat(conn, room, p)
        room.tell_all()
        if room.start_at is not None:
            conn.send({'t': 'start', 'at': room.start_at, 'seed': room.seed, 'now': now_ms(), 'again': True})
            room.tell_other(p, {'t': 'back'})
    elif not room or not p:
        return
    elif t == 'ready':
        if room.start_at is not None:
            return
        p.ready = bool(msg.get('on'))
        if len(room.players) == 2 and all(q.ready and q.conn for q in room.players):
            room.start_at = now_ms() + int(COUNTDOWN * 1000)
            room.seed = random.randint(1, 2 ** 31 - 1)
            for q in room.players:
                q.ready = q.finished = False
            room.tell_all()
            for q in room.players:
                q.conn.send({'t': 'start', 'at': room.start_at, 'seed': room.seed, 'now': now_ms()})
        else:
            room.tell_all()
    elif t == 'answer':
        ask = room.ask
        if not ask or p is not room.players[0]:
            return
        if not msg.get('ok'):
            end_ask(room, ('refused', '房主没有同意你加入'))
            return room.tell_all()
        end_ask(room)
        joiner = ask['conn']
        if not joiner.open or len(room.players) >= 2 or room.start_at is not None:
            return room.tell_all()
        leave(joiner)
        q = Player(ask['name'])
        room.players.append(q)
        seat(joiner, room, q)
        room.tell_all()
    elif t == 'pos':
        if room.start_at is None:
            return
        f = msg.get('f')
        h = msg.get('h')
        room.tell_other(p, {'t': 'opp', 'x': round(num(msg.get('x'), -2, 30), 3), 'y': round(num(msg.get('y'), -2, 30), 3),
                            'f': f if f in DIRS else 'down', 'm': round(num(msg.get('m'), -9999, 9999), 1),
                            'd': int(num(msg.get('d'), 0, 999)), 'b': int(num(msg.get('b'), 0, 3)),
                            'h': h if h in HALTS else ''})
    elif t == 'end':
        if room.start_at is None:
            return
        p.finished = True
        room.tell_other(p, {'t': 'oppEnd', 'm': round(num(msg.get('m'), -9999, 9999), 1),
                            'd': int(num(msg.get('d'), 0, 999)), 'early': bool(msg.get('early'))})
        if all(q.finished for q in room.players):
            room.start_at = None
            room.tell_all()
    elif t == 'leave':
        leave(conn)


async def http_reply(writer, code, body):
    raw = json.dumps(body, ensure_ascii=False).encode('utf-8')
    status = {200: 'OK', 400: 'Bad Request', 404: 'Not Found', 429: 'Too Many Requests'}[code]
    writer.write((f'HTTP/1.1 {code} {status}\r\nContent-Type: application/json; charset=utf-8\r\n'
                  f'Content-Length: {len(raw)}\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\n'
                  'Connection: close\r\n\r\n').encode('latin-1') + raw)
    try:
        await writer.drain()
    finally:
        writer.close()


async def serve(reader, writer):
    peer = writer.get_extra_info('peername') or ('?',)
    try:
        head = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 10)
    except Exception:
        writer.close()
        return
    if len(head) > 8192:
        writer.close()
        return
    lines = head.decode('latin-1').split('\r\n')
    parts = lines[0].split(' ')
    path = parts[1].split('?')[0] if len(parts) > 1 else ''
    hdr = {}
    for line in lines[1:]:
        if ':' in line:
            k, v = line.split(':', 1)
            hdr[k.strip().lower()] = v.strip()
    ip = peer[0]
    if ip in ('127.0.0.1', '::1') and hdr.get('x-forwarded-for'):
        ip = hdr['x-forwarded-for'].split(',')[0].strip()

    if path.rstrip('/') == '/vs/ping':
        return await http_reply(writer, 200, {'ok': True, 'name': '跑单王对战', 'rooms': len(rooms)})
    if path.rstrip('/') != '/vs' or hdr.get('upgrade', '').lower() != 'websocket' or not hdr.get('sec-websocket-key'):
        return await http_reply(writer, 404, {'error': '没有这个地址'})
    if conns_per_ip.get(ip, 0) >= MAX_CONN_PER_IP:
        return await http_reply(writer, 429, {'error': '连接太多了'})

    accept = base64.b64encode(hashlib.sha1((hdr['sec-websocket-key'] + WS_GUID).encode()).digest()).decode()
    writer.write(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                  f'Sec-WebSocket-Accept: {accept}\r\n\r\n').encode('latin-1'))
    conn = Conn(reader, writer, ip)
    conns_per_ip[ip] = conns_per_ip.get(ip, 0) + 1
    live.add(conn)
    try:
        while conn.open:
            raw = await conn.read_message()
            sec = int(time.time())
            n = conn.window[1] + 1 if conn.window[0] == sec else 1
            conn.window = (sec, n)
            if n > MSG_PER_SEC:
                break
            try:
                msg = json.loads(raw.decode('utf-8'))
            except (ValueError, UnicodeDecodeError):
                continue
            if isinstance(msg, dict):
                try:
                    handle(conn, msg)
                except Exception as e:  # a bug here should not take the whole program down
                    print('处理消息出错：', repr(e), flush=True)
    except (Closed, asyncio.IncompleteReadError, ConnectionError, OSError):
        pass
    finally:
        live.discard(conn)
        conns_per_ip[ip] = conns_per_ip.get(ip, 1) - 1
        if conns_per_ip[ip] <= 0:
            conns_per_ip.pop(ip, None)
        lost(conn)
        conn.close()


def lost(conn):
    """The connection ended. Mid-game the seat is held for SEAT_HOLD seconds; otherwise the player leaves."""
    cancel_ask(conn)
    room, p = conn.room, conn.player
    if not room or not p or p.conn is not conn:
        return
    if room.start_at is not None and not p.finished:
        p.conn, p.gone_at = None, time.time()
        conn.room = conn.player = None
        room.tell_other(p, {'t': 'away'})
        room.tell_all()
    else:
        leave(conn)


live = set()


async def housekeeping():
    while True:
        await asyncio.sleep(5)
        t = time.time()
        for conn in list(live):
            if t - conn.seen > IDLE:
                conn.close()
        for room in list(rooms.values()):
            for p in list(room.players):
                if p.conn is None and p.gone_at and t - p.gone_at > SEAT_HOLD:
                    drop(room, p)
            if room.ask and t - room.ask['at'] > ASK_WAIT:
                end_ask(room, ('timeout', '房主一直没回应，等会儿再试'))
                room.tell_all()
            if t - room.created > ROOM_LIFE and room.code in rooms:
                end_ask(room, ('gone', '房间开得太久，已经关了'))
                for p in list(room.players):
                    if p.conn:
                        p.conn.send({'t': 'error', 'code': 'gone', 'msg': '房间开得太久，已经关了'})
                        p.conn.room = p.conn.player = None
                rooms.pop(room.code, None)
        for ip in list(created_per_ip):
            created_per_ip[ip] = [x for x in created_per_ip[ip] if x > t - 3600]
            if not created_per_ip[ip]:
                del created_per_ip[ip]


async def main():
    srv = await asyncio.start_server(serve, HOST, PORT, limit=16384)
    chores = asyncio.create_task(housekeeping())
    print(f'跑单王对战在 {HOST}:{PORT} 上运行', flush=True)
    async with srv:
        await srv.serve_forever()
    chores.cancel()


if __name__ == '__main__':
    asyncio.run(main())
