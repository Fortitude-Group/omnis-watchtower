import { describe, expect, test } from 'vitest'
import { key } from '../../../src/plugin/core/model'
import { parseCommand } from '../../../src/plugin/core/parse'

const parse = (command: string) => parseCommand(command, 'main', 1)
const named = (command: string) => parse(command).flatMap((r) => r.packages.map((p) => p.name))

describe('reserved words and grouping do not hide installs', () => {
  test.each([
    ['if true; then npm install evil-pkg; fi', 'evil-pkg'],
    ['if npm i evil-pkg; then echo ok; fi', 'evil-pkg'],
    ['if false; then :; elif true; then npm i evil-pkg; else pip install evil; fi', 'evil-pkg'],
    ['{ npm i evil-pkg; }', 'evil-pkg'],
    ['for x in 1; do pip install evil; done', 'evil'],
    ['while true; do npm i evil-pkg; break; done', 'evil-pkg'],
    ['until false; do npm i evil-pkg; done', 'evil-pkg'],
    ['! npm i evil-pkg', 'evil-pkg'],
    ['time npm i evil-pkg', 'evil-pkg'],
    ['( npm i evil-pkg )', 'evil-pkg'],
    ['(cd app && npm i evil-pkg)', 'evil-pkg'],
    ['case $x in x) npm i evil-pkg;; esac', 'evil-pkg'],
    ['case $x in a|b) pip install evil ;; *) true ;; esac', 'evil'],
    ['f() { npm i evil-pkg; }; f', 'evil-pkg'],
  ])('%s', (command, pkg) => {
    expect(named(command)).toContain(pkg)
  })

  test('spans still point at the original token', () => {
    const command = 'if true; then { npm i -D evil-pkg; }; fi'
    const [r] = parse(command)
    expect(command.slice(...r!.spans![key({ ecosystem: 'npm', name: 'evil-pkg' })]!)).toBe('evil-pkg')
  })

  test('a subshell cd still moves the lockfile directory', () => {
    expect(parse('(cd web && npm install)')[0]!.files).toEqual(['web'])
  })
})

describe('heredocs fed to an interpreter', () => {
  test.each([
    "bash <<'EOF'\nnpm install evil-pkg\nEOF",
    'sh <<EOF\nnpm i evil-pkg\nEOF\n',
    'zsh <<-EOF\n\tnpm i evil-pkg\n\tEOF',
    'cat <<EOF | bash\nnpm i evil-pkg\nEOF',
    'sudo bash -s <<EOF\ncd app\nnpm i evil-pkg\nEOF',
  ])('%j is flagged and its body parsed', (command) => {
    const r = parse(command)
    expect(r[0]).toMatchObject({ tool: 'shell', packages: [], source: 'explicit' })
    expect(r[0]!.unchecked).toHaveLength(1)
    expect(named(command)).toContain('evil-pkg')
    for (const x of r) {
      expect(x.command).toBe(command)
      expect(x.spans).toBeUndefined()
    }
  })

  test('the body inherits the working directory', () => {
    const r = parse('cd svc && bash <<EOF\nnpm install\nEOF')
    expect(r.map((x) => [x.tool, x.source, x.files])).toEqual([
      ['shell', 'explicit', undefined],
      ['npm', 'lockfile-diff', ['svc']],
    ])
  })

  test.each(['python - <<EOF\nimport os; os.system("pip install evil")\nEOF', 'node - <<EOF\nrequire("child_process")\nEOF', 'python3 <<EOF\nprint(1)\nEOF'])(
    '%j is unchecked without parsing the body',
    (command) => {
      const r = parse(command)
      expect(r).toHaveLength(1)
      expect(r[0]).toMatchObject({ tool: 'shell', packages: [] })
    },
  )

  test('a heredoc into a non-interpreter is not flagged', () => {
    expect(parse('cat <<EOF > notes.txt\nnpm i evil-pkg\nEOF')).toEqual([])
    expect(parse('bash script.sh <<EOF\nnpm i evil-pkg\nEOF')).toEqual([])
  })

  test('ids stay distinct across body requests', () => {
    const ids = parse('bash <<EOF\nnpm i a\npip install b\nEOF').map((r) => r.id)
    expect(new Set(ids).size).toBe(3)
  })
})
