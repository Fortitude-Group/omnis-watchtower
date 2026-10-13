import { describe, expect, test } from 'vitest'
import { tokenize, unwrap } from '../../../src/plugin/core/parse/tokenize'

const words = (input: string) => tokenize(input).map((s) => s.commands.map((c) => c.words.map((w) => w.text)))

describe('tokenize', () => {
  test('empty and blank input yield nothing', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('   \n\t ')).toEqual([])
  })

  test('splits words on whitespace', () => {
    expect(words('npm  install\tchalk')).toEqual([[['npm', 'install', 'chalk']]])
  })

  test('single quotes are literal', () => {
    expect(words(`pip install 'requests>=2, <3' '$HOME'`)).toEqual([[['pip', 'install', 'requests>=2, <3', '$HOME']]])
    expect(tokenize(`echo '$HOME'`)[0]!.commands[0]!.words[1]!.dynamic).toBe(false)
  })

  test('double quotes join words and honour escapes', () => {
    expect(words(`pip install "flask[async] == 3.0" "a\\"b"`)).toEqual([[['pip', 'install', 'flask[async] == 3.0', 'a"b']]])
  })

  test('backslash escapes outside quotes', () => {
    expect(words('npm i foo\\ bar \\;x')).toEqual([[['npm', 'i', 'foo bar', ';x']]])
  })

  test('chains split on && || ; & and newlines', () => {
    expect(words('npm i a && pip install b || yarn add c; bun add d & pnpm add e\nuv add f')).toEqual([
      [['npm', 'i', 'a']],
      [['pip', 'install', 'b']],
      [['yarn', 'add', 'c']],
      [['bun', 'add', 'd']],
      [['pnpm', 'add', 'e']],
      [['uv', 'add', 'f']],
    ])
  })

  test('operators inside quotes are not split', () => {
    expect(words(`echo "a && b; c | d"`)).toEqual([[['echo', 'a && b; c | d']]])
  })

  test('pipelines stay in one segment as separate commands', () => {
    expect(words('npm i chalk 2>&1 | tail -5')).toEqual([[['npm', 'i', 'chalk'], ['tail', '-5']]])
  })

  test('redirections and their targets are dropped', () => {
    expect(words('npm i chalk > out.log 2>/dev/null &>> all.log <in')).toEqual([[['npm', 'i', 'chalk']]])
  })

  test('line continuations join lines', () => {
    expect(words('pip install \\\n  requests \\\r\n  flask')).toEqual([[['pip', 'install', 'requests', 'flask']]])
  })

  test('comments are ignored but # inside a word is kept', () => {
    expect(words('npm i user/repo#main # install it')).toEqual([[['npm', 'i', 'user/repo#main']]])
  })

  test('variables and globs mark a word dynamic', () => {
    const [seg] = tokenize('npm i $PKG "${NAME}" lodash* plain')
    expect(seg!.commands[0]!.words.map((w) => w.dynamic)).toEqual([false, false, true, true, true, false])
  })

  test('command substitution, backticks, subshells, heredocs mark the segment unsafe', () => {
    expect(tokenize('npm i $(cat list)')[0]!.unsafe).toBe('command substitution')
    expect(tokenize('npm i `cat list`')[0]!.unsafe).toBe('command substitution')
    expect(tokenize('npm i "$(cat list)"')[0]!.unsafe).toBe('command substitution')
    expect(tokenize('pip install -r <(curl x)')[0]!.unsafe).toBe('process substitution')
    expect(tokenize("npm i 'unterminated")[0]!.unsafe).toBe('unterminated quote')
    expect(tokenize('npm i a && echo ok')[1]!.unsafe).toBeUndefined()
  })

  test('substitutions stay one opaque word; grouping parens split segments', () => {
    expect(words('npm i $(cat "a)b" list) x')).toEqual([[['npm', 'i', '$(cat "a)b" list)', 'x']]])
    expect(words('npm i `cat list` x')).toEqual([[['npm', 'i', '`cat list`', 'x']]])
    expect(words('bash <(curl -s u)')).toEqual([[['bash', '<(curl -s u)']]])
    expect(words('(cd x && npm i y)')).toEqual([[['cd', 'x']], [['npm', 'i', 'y']]])
    expect(tokenize('(cd x && npm i y)').some((s) => s.unsafe)).toBe(false)
  })

  test('heredoc bodies are attached to their segment', () => {
    const [seg] = tokenize("bash <<'EOF'\nnpm i a\npip install b\nEOF\n")
    expect(seg!.heredocs).toEqual(['npm i a\npip install b'])
  })

  test('heredoc bodies are skipped', () => {
    const segs = tokenize('cat <<EOF > r.txt\nnpm i evil\nEOF\nnpm i good')
    expect(segs).toHaveLength(2)
    expect(segs[0]!.unsafe).toBe('heredoc')
    expect(segs[1]!.commands[0]!.words.map((w) => w.text)).toEqual(['npm', 'i', 'good'])
  })

  test('raw keeps the segment text', () => {
    expect(tokenize('cd app && npm i x | cat').map((s) => s.raw)).toEqual(['cd app', 'npm i x | cat'])
  })
})

describe('unwrap', () => {
  const run = (input: string) => {
    const inv = unwrap(tokenize(input)[0]!.commands[0]!.words)
    return { words: inv.words.map((w) => w.text), env: inv.env }
  }

  test('env-var prefixes are stripped and recorded', () => {
    expect(run('CI=1 NODE_ENV=production npm i x')).toEqual({ words: ['npm', 'i', 'x'], env: { CI: '1', NODE_ENV: 'production' } })
  })

  test('sudo and its options are stripped', () => {
    expect(run('sudo -E -u root npm i -g x').words).toEqual(['npm', 'i', '-g', 'x'])
  })

  test('env, time, nohup, nice, timeout and corepack wrappers are stripped', () => {
    expect(run('env -i PATH=/bin pip install x').words).toEqual(['pip', 'install', 'x'])
    expect(run('time nohup nice -n 5 timeout 30s corepack pnpm add x').words).toEqual(['pnpm', 'add', 'x'])
  })

  test('program names lose their directory and Windows extension', () => {
    expect(run('/usr/local/bin/pip3 install x').words[0]).toBe('pip3')
    expect(run(`'C:\\nodejs\\NPM.cmd' i x`).words[0]).toBe('npm')
    expect(run('.venv/bin/python -m pip install x').words[0]).toBe('python')
  })

  test('opening reserved words are stripped unless quoted', () => {
    expect(run('then npm i x').words).toEqual(['npm', 'i', 'x'])
    expect(run('! { npm i x').words).toEqual(['npm', 'i', 'x'])
    expect(run(`'then' x`).words).toEqual(['then', 'x'])
  })

  test('a bare assignment leaves no command', () => {
    expect(run('FOO=bar').words).toEqual([])
  })
})
