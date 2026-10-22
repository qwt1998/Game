#!/usr/bin/env python3
"""Builds 3d.html, the 3D trial page, from index.html.

The trial page is the same game (rules, controls, screens, rider records, leaderboard) with the map drawn
by 3d/scene.js instead of the 2D canvas code. Run this after every change to index.html so both pages play
the same:

    python3 3d/make.py

If a change in index.html moved one of the spots patched below, this stops with a message instead of
writing a broken page; adjust the matching anchor here.
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

CSS = """
/* 3D trial page: the WebGL city sits under the 2D canvas, which now only carries names, bubbles and markers */
#gl{position:absolute;left:0;top:0;display:block;border-radius:16px;background:#26332B}
#map{position:relative;z-index:1;background:transparent}
.no3d #gl{display:none}
.no3d #map{background:var(--land)}
.mode3d{margin:-4px 0 14px;font-size:13px;line-height:1.6;color:var(--muted)}
.mode3d a{color:var(--signal);font-weight:700;white-space:nowrap}
"""

HOOK = """// ---------- 3D view (3d.html only, added by 3d/make.py) ----------
const G3=window.Paodan3D?window.Paodan3D({
  get S(){return S},get T(){return T},get dpr(){return dpr},W:W,H:H,canvas:canvas,ctx:ctx,draw2d:draw2d,
  grid:grid,tile:tile,passable:passable,isMainCh:isMainCh,LANE_DIR:LANE_DIR,BLOCKS:BLOCKS,places:places,stations:stations,repairs:repairs,
  INTERS:INTERS,LANES:LANES,C:C,FONT:FONT,NUM:NUM,fmtMoney:fmtMoney,clamp:clamp,rr:rr,circle:circle,bolt:bolt,chevron:chevron,
  crossingH:crossingH,crossingV:crossingV,isCrossing:isCrossing,playerPos:playerPos,carCenter:carCenter,lightPhase:lightPhase,
  isWrongWay:isWrongWay,isRain:isRain,reduceMotion:reduceMotion,navRoute:navRoute
}):(function(){document.body.classList.add('no3d');return {draw:draw2d,resize:function(){}};})();
function draw(now){G3.draw(now);}
"""

PATCHES = [
    ('<title>午高峰跑单</title>', '<title>午高峰跑单 3D 试玩</title>'),
    ('      <canvas id="map" ', '      <canvas id="gl" aria-hidden="true"></canvas>\n      <canvas id="map" '),
    ('\n</style>', CSS + '</style>'),
    ('<p class="eyebrow">外卖骑手 · 11:00–13:30</p>',
     '<p class="eyebrow">外卖骑手 · 11:00–13:30 · 3D 试玩</p>\n'
     '    <p class="mode3d" id="mode3d"><span>3D 试玩版：玩法和正式版一样，成绩也一起记。</span><a href="./">回到正式版</a></p>'),
    ('<script>\n(function(){', '<script type="module" src="3d/scene.js"></script>\n<script type="module">\n(function(){'),
    ('function draw(now){\n  if(staticDirty)buildStatic();', HOOK + 'function draw2d(now){\n  if(staticDirty)buildStatic();'),
    ("    canvas.style.width=W*T+'px';canvas.style.height=H*T+'px';\n",
     "    canvas.style.width=W*T+'px';canvas.style.height=H*T+'px';\n    G3.resize();\n"),
]


def main():
    src = (ROOT / 'index.html').read_text(encoding='utf-8')
    for old, new in PATCHES:
        n = src.count(old)
        if n != 1:
            sys.exit(f'3d/make.py：index.html 里要改的地方出现了 {n} 次（应该正好 1 次），没有生成 3d.html。找的是：{old[:60]!r}')
        src = src.replace(old, new)
    (ROOT / '3d.html').write_text(src, encoding='utf-8')
    print('已生成 3d.html')


if __name__ == '__main__':
    main()
