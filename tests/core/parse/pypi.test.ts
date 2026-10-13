import { describe, expect, test } from 'vitest'
import { expandRequest, filesNeeded, parseCommand, parseRequirements } from '../../../src/plugin/core/parse'

const parse = (command: string) => parseCommand(command, 'main', 1000)
const one = (command: string) => {
  const r = parse(command)
  expect(r).toHaveLength(1)
  return r[0]!
}
const refs = (command: string) => one(command).packages

describe('pip spellings', () => {
  test.each([
    ['pip install requests', 'pip'],
    ['pip3 install requests', 'pip'],
    ['pip3.12 install requests', 'pip'],
    ['python -m pip install requests', 'pip'],
    ['python3 -m pip install requests', 'pip'],
    ['python3.11 -m pip install --user requests', 'pip'],
    ['py -3 -m pip install requests', 'pip'],
    ['.venv/bin/python -m pip install requests', 'pip'],
    ['sudo -H pip install requests', 'pip'],
    ['uv pip install requests', 'uv'],
    ['uv add requests', 'uv'],
    ['poetry add requests', 'poetry'],
    ['pipx install requests', 'pipx'],
    ['pipx run requests', 'pipx'],
    ['uvx requests', 'uv'],
    ['uv tool install requests', 'uv'],
    ['uv tool run requests', 'uv'],
  ])('%s', (command, tool) => {
    const r = one(command)
    expect(r.tool).toBe(tool)
    expect(r.packages).toEqual([{ ecosystem: 'pypi', name: 'requests' }])
    expect(r.unchecked).toEqual([])
  })
})

describe('specifiers and extras', () => {
  test.each([
    ['requests==2.31.0', { version: '2.31.0' }],
    ['requests===2.31.0', { version: '2.31.0' }],
    ["'requests>=2.0'", { version: '>=2.0' }],
    ["'requests~=2.31'", { version: '~=2.31' }],
    ["'requests!=2.30'", { version: '!=2.30' }],
    ["'requests>=2,<3'", { version: '>=2,<3' }],
    ["'requests == 2.*'", { version: '==2.*' }],
    ["'requests[socks]'", { extras: ['socks'] }],
    ["'requests[socks,Security]==2.31'", { version: '2.31', extras: ['socks', 'security'] }],
    ["'requests; python_version < \"3.12\"'", {}],
  ])('%s', (spec, extra) => {
    expect(refs(`pip install ${spec}`)).toEqual([{ ecosystem: 'pypi', name: 'requests', ...extra }])
  })

  test('names are PEP 503 normalised', () => {
    expect(refs('pip install PyYAML Typing_Extensions zope.interface').map((p) => p.name)).toEqual([
      'pyyaml',
      'typing-extensions',
      'zope-interface',
    ])
  })

  test('poetry and uvx read name@version', () => {
    expect(refs('poetry add requests@^2.31')).toEqual([{ ecosystem: 'pypi', name: 'requests', version: '^2.31' }])
    expect(refs('poetry add requests@latest')).toEqual([{ ecosystem: 'pypi', name: 'requests' }])
    expect(refs('uvx ruff@0.4.0 check .')).toEqual([{ ecosystem: 'pypi', name: 'ruff', version: '0.4.0' }])
  })

  test('pip treats name@... as a direct reference, which is unchecked', () => {
    expect(one("pip install 'pkg @ https://x.example/pkg.whl'").unchecked).toEqual(['pkg @ https://x.example/pkg.whl'])
  })

  test('flags are not packages', () => {
    const r = one('pip install -U --user --no-cache-dir -q --target ./vendor --upgrade requests')
    expect(r.packages.map((p) => p.name)).toEqual(['requests'])
    expect(r.unchecked).toEqual([])
  })

  test('pipx run --spec and uvx --from name the package; the positional is the command', () => {
    expect(refs('pipx run --spec httpie http GET x')).toEqual([{ ecosystem: 'pypi', name: 'httpie' }])
    expect(refs('uvx --from httpie http GET x')).toEqual([{ ecosystem: 'pypi', name: 'httpie' }])
  })

  test('--with adds packages to run and tool commands', () => {
    expect(refs('uv run --with rich --with httpx script.py').map((p) => p.name)).toEqual(['rich', 'httpx'])
    expect(refs('uvx --with rich black .').map((p) => p.name)).toEqual(['rich', 'black'])
    expect(parse('uv run pytest')).toEqual([])
  })

  test('pipx inject skips the target venv', () => {
    expect(refs('pipx inject poetry poetry-plugin-export').map((p) => p.name)).toEqual(['poetry-plugin-export'])
  })
})

describe('unchecked forms', () => {
  test.each([
    ['-e .', '-e .'],
    ['--editable=./pkg', '--editable ./pkg'],
    ['.', '.'],
    ['./pkg', './pkg'],
    ['/abs/pkg', '/abs/pkg'],
    ['dist/pkg-1.0-py3-none-any.whl', 'dist/pkg-1.0-py3-none-any.whl'],
    ['pkg-1.0.tar.gz', 'pkg-1.0.tar.gz'],
    ['git+https://github.com/a/b.git', 'git+https://github.com/a/b.git'],
    ['https://example.com/pkg.zip', 'https://example.com/pkg.zip'],
    ["'requests>>2'", 'requests>>2'],
    ['$PKG', '$PKG'],
    ['req*', 'req*'],
  ])('pip install %s', (arg, expected) => {
    const r = one(`pip install ${arg}`)
    expect(r.packages).toEqual([])
    expect(r.unchecked).toEqual([expected])
  })

  test('python -c naming pip is an unreadable shell string', () => {
    expect(one('python -c "import pip"').unchecked).toEqual(['python -c "import pip"'])
  })

  test('bare pip install is not a request', () => {
    expect(parse('pip install')).toEqual([])
    expect(parse('pip list')).toEqual([])
    expect(parse('python script.py install')).toEqual([])
  })
})

describe('index URLs', () => {
  test('--index-url, -i and --extra-index-url are captured', () => {
    expect(one('pip install --index-url https://a.example/simple -i https://b.example x').indexUrls).toEqual([
      'https://a.example/simple',
      'https://b.example',
    ])
    expect(one('pip install --extra-index-url=https://c.example x').indexUrls).toEqual(['https://c.example'])
    expect(one('uv pip install --index https://d.example x').indexUrls).toEqual(['https://d.example'])
    expect(one(`pipx install --pip-args='--index-url https://e.example' x`).indexUrls).toEqual(['https://e.example'])
  })

  test('PIP_INDEX_URL env prefix is captured', () => {
    expect(one('PIP_INDEX_URL=https://p.example pip install x').indexUrls).toEqual(['https://p.example'])
  })
})

describe('requirements files', () => {
  test('-r makes a requirements-file request with the files to read', () => {
    const r = one('pip install -r requirements.txt -r dev.txt flask')
    expect(r.source).toBe('requirements-file')
    expect(r.files).toEqual(['requirements.txt', 'dev.txt'])
    expect(r.packages).toEqual([{ ecosystem: 'pypi', name: 'flask' }])
  })

  test('files resolve against cd', () => {
    expect(one('cd api && pip install -r reqs/base.txt').files).toEqual(['api/reqs/base.txt'])
    expect(one('pip install -r /abs/r.txt').files).toEqual(['/abs/r.txt'])
  })

  test('uv pip sync and uv add -r', () => {
    expect(one('uv pip sync requirements.lock').files).toEqual(['requirements.lock'])
    expect(one('uv add -r requirements.txt').files).toEqual(['requirements.txt'])
  })

  test('parseRequirements handles comments, options, markers, hashes and continuations', () => {
    const r = parseRequirements(
      [
        '# top comment',
        '--index-url https://idx.example/simple',
        '-r base.txt',
        '--requirement=extra.txt',
        '-c constraints.txt',
        'requests==2.31.0 \\',
        '    --hash=sha256:abc',
        'flask[async] >= 3.0 ; python_version >= "3.9"  # web',
        '-e git+https://github.com/a/b.git#egg=b',
        'pkg @ https://x.example/pkg.whl',
        '',
        'Django',
      ].join('\n'),
    )
    expect(r.includes).toEqual(['base.txt', 'extra.txt'])
    expect(r.indexUrls).toEqual(['https://idx.example/simple'])
    expect(r.packages).toEqual([
      { ecosystem: 'pypi', name: 'requests', version: '2.31.0' },
      { ecosystem: 'pypi', name: 'flask', version: '>=3.0', extras: ['async'] },
      { ecosystem: 'pypi', name: 'django' },
    ])
    expect(r.unchecked).toEqual(['-e git+https://github.com/a/b.git#egg=b', 'pkg @ https://x.example/pkg.whl'])
  })

  test('filesNeeded walks nested -r includes until everything is read', () => {
    const req = one('cd app && pip install -r requirements.txt')
    const files: Record<string, string | null> = {}
    expect(filesNeeded(req, files)).toEqual(['app/requirements.txt'])
    files['app/requirements.txt'] = '-r reqs/base.txt\nflask'
    expect(filesNeeded(req, files)).toEqual(['app/reqs/base.txt'])
    files['app/reqs/base.txt'] = '-r ../requirements.txt\nrequests\n-r missing.txt'
    expect(filesNeeded(req, files)).toEqual(['app/reqs/missing.txt'])
    files['app/reqs/missing.txt'] = null
    expect(filesNeeded(req, files)).toEqual([])
    const full = expandRequest(req, files)
    expect(full.packages.map((p) => p.name)).toEqual(['flask', 'requests'])
    expect(full.unchecked).toEqual(['app/reqs/missing.txt (unreadable)'])
  })

  test('an unread file is reported unchecked, never silently dropped', () => {
    const req = one('pip install -r r.txt')
    expect(expandRequest(req, {}).unchecked).toEqual(['r.txt (unreadable)'])
  })

  test('index URLs in a requirements file join the request', () => {
    const req = one('pip install -r r.txt')
    expect(expandRequest(req, { 'r.txt': '-i https://i.example\nx' }).indexUrls).toEqual(['https://i.example'])
  })
})

describe('bare installs → lockfile-diff', () => {
  test.each([
    ['uv sync', 'uv'],
    ['poetry install', 'poetry'],
    ['poetry sync', 'poetry'],
  ])('%s', (command, tool) => {
    expect(one(command)).toMatchObject({ tool, source: 'lockfile-diff', files: [''] })
  })

  test('uv --directory and poetry -C set the project directory', () => {
    expect(one('uv sync --directory svc').files).toEqual(['svc'])
    expect(one('poetry -C svc install').files).toEqual(['svc'])
  })
})
