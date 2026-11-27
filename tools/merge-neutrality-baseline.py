#!/usr/bin/env python3
"""Merge a branch's neutrality-baseline extension into the current baseline file.

usage: merge-neutrality-baseline.py <merge-base-rev> <theirs-rev>   (run in the repo root, on the branch being merged INTO)

Takes the working-tree baseline as-is, then adds only what <theirs-rev> added relative to <merge-base-rev>:
new baselineEntries (by file+kind+token), their hitsByFile lines, the entryCount/totalObservedHits deltas
and the new lastExtension prefix. Textual insertion, so the file keeps its formatting. Shrink-only ratchet
is untouched: nothing is removed, and the guard must still pass afterwards.
"""
import sys, json, re, subprocess
P = 'architecture/coregrid-mvp-architecture/NEUTRALITY_GUARD_BASELINE.json'
base_rev, theirs_rev = sys.argv[1], sys.argv[2]
show = lambda rev: json.loads(subprocess.check_output(['git', 'show', f'{rev}:{P}']))
base, theirs = show(base_rev), show(theirs_rev)
s = open(P).read()
key = lambda e: (e['file'], e['kind'], e['token'])
have = {key(e) for e in json.loads(s)['baselineEntries']}
basek = {key(e) for e in base['baselineEntries']}
new = [e for e in theirs['baselineEntries'] if key(e) not in basek and key(e) not in have]
if not new:
    print('nothing to add'); sys.exit(0)
hits = sum(e['occurrences'] for e in new)
k = s.index('"baselineEntries"'); j = s.index('{', s.index('[', k)); ind = s[s.rfind('\n', 0, j) + 1:j]
last = s.rindex('}', 0, s.rindex(']'))
blk = ',\n'.join('\n'.join(ind + x for x in json.dumps(e, indent=2, ensure_ascii=False).split('\n')) for e in new)
s = s[:last + 1] + ',\n' + blk + s[last + 1:]
def bump(name, add):
    global s
    m = re.search(r'"%s":\s*(\d+)' % name, s); s = s[:m.start(1)] + str(int(m.group(1)) + add) + s[m.end(1):]
bump('entryCount', len(new)); bump('totalObservedHits', hits)
files = {}
for e in new: files[e['file']] = files.get(e['file'], 0) + e['occurrences']
m = re.search(r'("hitsByFile":\s*\{)', s)
s = s[:m.end(1)] + ''.join('\n      "%s": %d,' % (f, c) for f, c in files.items()) + s[m.end(1):]
bl, tl = base['meta'].get('lastExtension', ''), theirs['meta'].get('lastExtension', '')
add = tl[:len(tl) - len(bl)] if bl and tl.endswith(bl) else ''
if add:
    m = re.search(r'("lastExtension":\s*")', s); s = s[:m.end(1)] + add + s[m.end(1):]
json.loads(s); open(P, 'w').write(s)
print(f'added {len(new)} groups, {hits} hits')
