#!/usr/bin/env python3
"""
One-time upgrade for the course leaderboards.

Accounts created before the course leaderboards existed have exam records
(attempts) but no per-course bests. This script rebuilds, for each such
student, their best score in every course from their own past exams and
writes it through the normal Firestore REST API. The security rules check
every value against the real exam records, exactly like the app does.

Usage:
  python3 tools/upgrade-old-scores.py                 # live project from js/config.js
  python3 tools/upgrade-old-scores.py --emulator 127.0.0.1:8080 --project demo-cbt
  add --dry-run to only print what would change.
"""
import json, os, re, ssl, sys, urllib.request, urllib.parse

MIN_OVERALL = 4


def load_config():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    text = open(os.path.join(root, 'js', 'config.js'), encoding='utf-8').read()
    get = lambda k: re.search(k + r':\s*"([^"]*)"', text).group(1)
    m = re.search(r'overallMinCourses:\s*(\d+)', text)
    return get('apiKey'), get('projectId'), int(m.group(1)) if m else 4


def make_client(base, key):
    cafile = '/root/.ccr/ca-bundle.crt'
    ctx = ssl.create_default_context(cafile=cafile) if os.path.exists(cafile) and base.startswith('https') else None

    def call(method, path, body=None, params=None):
        q = dict(params or {})
        if key:
            q['key'] = key
        url = base + path + ('?' + urllib.parse.urlencode(q) if q else '')
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, context=ctx, timeout=60) as r:
                return json.loads(r.read() or b'{}')
        except urllib.error.HTTPError as e:
            raise RuntimeError(f'{e.code} {e.read().decode()[:400]}')
    return call


def val(v):
    if v is None:
        return None
    if 'integerValue' in v: return int(v['integerValue'])
    if 'doubleValue' in v: return float(v['doubleValue'])
    if 'stringValue' in v: return v['stringValue']
    if 'booleanValue' in v: return v['booleanValue']
    if 'timestampValue' in v: return v['timestampValue']
    if 'mapValue' in v: return {k: val(x) for k, x in v['mapValue'].get('fields', {}).items()}
    if 'nullValue' in v: return None
    return v


def pct_of(score, total):
    # Same rounding as the app: Math.round(score / total * 1000) / 10 (JS rounds .5 up)
    import math
    return math.floor(score / total * 1000 + 0.5) / 10 if total else 0


def main():
    args = sys.argv[1:]
    dry = '--dry-run' in args
    key, project, min_overall = load_config()
    if '--project' in args:
        project = args[args.index('--project') + 1]
    if '--emulator' in args:
        host = args[args.index('--emulator') + 1]
        base, key = f'http://{host}/v1/projects/{project}/databases/(default)/documents', ''
    else:
        base = f'https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents'
    call = make_client(base, key)
    docroot = f'projects/{project}/databases/(default)/documents'

    students, token = [], None
    while True:
        res = call('GET', '/students', params={'pageSize': 300, **({'pageToken': token} if token else {})})
        students += res.get('documents', [])
        token = res.get('nextPageToken')
        if not token:
            break
    print(f'{len(students)} students found')

    done = skipped = failed = 0
    for sdoc in students:
        sid = sdoc['name'].split('/')[-1]
        f = {k: val(v) for k, v in sdoc.get('fields', {}).items()}
        if 'coursesTaken' in f or not f.get('attempts'):
            skipped += 1
            continue
        rows = call('POST', ':runQuery', body={'structuredQuery': {
            'from': [{'collectionId': 'attempts'}],
            'where': {'fieldFilter': {'field': {'fieldPath': 'sid'}, 'op': 'EQUAL', 'value': {'stringValue': sid}}}}})
        per = {}
        for row in rows:
            d = row.get('document')
            if not d:
                continue
            aid = d['name'].split('/')[-1]
            a = {k: val(v) for k, v in d.get('fields', {}).items()}
            for code, pc in (a.get('perCourse') or {}).items():
                if not pc or not pc.get('total'):
                    continue
                p = pct_of(pc['score'], pc['total'])
                c = per.setdefault(code, {'attempts': 0, 'best': None})
                c['attempts'] += 1
                at = a.get('createdAt') or ''
                if c['best'] is None or p > c['best']['pct'] or (p == c['best']['pct'] and at < c['best']['at']):
                    c['best'] = {'pct': p, 'score': pc['score'], 'total': pc['total'], 'src': aid, 'at': at}
        if not per:
            skipped += 1
            continue
        course_best = {code: c['best']['pct'] for code, c in per.items()}
        overall = None
        if len(course_best) >= min_overall:
            import math
            overall = math.floor(sum(course_best.values()) / len(course_best) * 10 + 0.5) / 10
        print(f"  {f.get('name')} ({f.get('matric')}): " + ', '.join(f'{k} {v}%' for k, v in sorted(course_best.items()))
              + (f' -> overall {overall}%' if overall is not None else ''))
        if dry:
            continue
        ts = lambda *names: [{'fieldPath': n, 'setToServerValue': 'REQUEST_TIME'} for n in names]
        writes = []
        for code, c in per.items():
            b = c['best']
            writes.append({'update': {'name': f'{docroot}/board_{code}/{sid}', 'fields': {
                'name': {'stringValue': f['name']}, 'matric': {'stringValue': f['matric']},
                'bestPct': {'doubleValue': b['pct']}, 'bestScore': {'integerValue': str(b['score'])},
                'bestTotal': {'integerValue': str(b['total'])}, 'attempts': {'integerValue': str(c['attempts'])},
                'src': {'stringValue': b['src']}}},
                'updateTransforms': ts('bestAt', 'updatedAt'), 'currentDocument': {'exists': False}})
        sfields = {'courseBest': {'mapValue': {'fields': {k: {'doubleValue': v} for k, v in course_best.items()}}},
                   'coursesTaken': {'integerValue': str(len(course_best))}}
        mask = ['courseBest', 'coursesTaken']
        tlist = ['updatedAt']
        if overall is not None:
            sfields['overallPct'] = {'doubleValue': overall}
            mask.append('overallPct')
            tlist.append('overallAt')
        writes.append({'update': {'name': f'{docroot}/students/{sid}', 'fields': sfields},
                       'updateMask': {'fieldPaths': mask}, 'updateTransforms': ts(*tlist),
                       'currentDocument': {'exists': True}})
        try:
            call('POST', ':commit', body={'writes': writes})
            done += 1
        except RuntimeError as e:
            failed += 1
            print(f'    FAILED: {e}')
    print(f'Upgraded {done}, already up to date or nothing to upgrade {skipped}, failed {failed}' + (' (dry run)' if dry else ''))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
