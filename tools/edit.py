"""Tiny helper: python3 tools/edit.py <file> <<'PAIRS' with blocks separated by lines '=====' and '-----' (old ----- new)."""
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
blocks = sys.stdin.read().split('\n=====\n')
for i, b in enumerate(blocks):
    if not b.strip():
        continue
    old, new = b.split('\n-----\n')
    if old not in s:
        sys.exit('edit %d did not match in %s:\n%s' % (i, p, old[:300]))
    if s.count(old) > 1:
        sys.exit('edit %d matches %d times in %s:\n%s' % (i, s.count(old), p, old[:200]))
    s = s.replace(old, new)
open(p, 'w', encoding='utf-8').write(s)
print('ok', p, len(blocks))
