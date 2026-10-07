#!/usr/bin/env python3
"""真实 Chrome DOM 验证：统一 TTS 语速控件。
加载 index.html#/day/1，断言可见文案与按钮，并截图。"""
import subprocess, sys, os, re, time, json

ROOT = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(ROOT, 'index.html')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
PROFILE = '/tmp/eng30_tts_prof'

url = 'file://' + HTML + '#/day/1'

def run(args, t=30):
    return subprocess.run([CHROME] + args, capture_output=True, text=True, timeout=t)

# 1) dump-dom：旧版 headless 在 load 后即输出；SPA 在 DOMContentLoaded 同步渲染
dump = run([
    '--headless', '--disable-gpu', '--no-sandbox',
    '--user-data-dir=' + PROFILE,
    '--no-first-run', '--no-default-browser-check',
    '--dump-dom', url
], t=30)
html = dump.stdout
if not html:
    print('STDERR:', dump.stderr[-1500:])

checks = [
    ('四个档位按钮存在', ['慢速', '学习', '自然', '标准']),
    ('当前速度文案 0.75× 学习速度', ['0.75× 学习速度']),
    ('引入 tts-controller.js', ['tts-controller.js']),
    ('引入 tts-controller.css', ['tts-controller.css']),
]
print('== DOM 断言 ==')
ok = True
for name, needles in checks:
    missing = [n for n in needles if n not in html]
    if missing:
        ok = False
        print('  ✗ %s 缺少: %s' % (name, missing))
    else:
        print('  ✓ %s' % name)

# range 范围
m = re.search(r'<input type="range" id="tts-rate"[^>]*>', html)
if m:
    tag = m.group(0)
    for attr in ['min="0.6"', 'max="1.0"']:
        good = attr in tag
        print(('  ✓ ' if good else '  ✗ ') + 'tts-rate ' + attr)
        ok = ok and good
else:
    print('  ✗ 未找到 #tts-rate'); ok = False

# 2) 截图阅读面板
shot = os.path.join(ROOT, '_shot_tts_speed.png')
run([
    '--headless', '--disable-gpu', '--no-sandbox',
    '--user-data-dir=' + PROFILE,
    '--no-first-run', '--no-default-browser-check',
    '--window-size=900,1400',
    '--screenshot=' + shot,
    url
], t=30)
print('截图:', shot, 'exists=', os.path.exists(shot))
sys.exit(0 if ok else 1)
