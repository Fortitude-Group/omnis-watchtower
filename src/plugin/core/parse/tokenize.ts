// POSIX-ish word splitting for install detection. Anything it cannot read safely marks the segment unsafe.

/** One shell word after quote removal. `dynamic` = it holds an expansion or glob, so its value is unknown. */
export type Word = { text: string; dynamic: boolean }
export type Command = { words: Word[]; raw: string }
/** A chain element (split on `&&`, `||`, `;`, `&`, newline): a pipeline of one or more commands. */
export type Segment = { raw: string; commands: Command[]; unsafe?: string }
export type Invocation = { words: Word[]; env: Record<string, string> }

const NAME_START = /[A-Za-z_]/
const SPECIAL_PARAM = /[0-9?@*#$!-]/

/** Splits a shell command into chain segments, each a pipeline of commands made of words. */
export const tokenize = (input: string): Segment[] => {
  const src = input.replace(/\\\r?\n/g, '')
  const segments: Segment[] = []
  const heredocs: string[] = []
  let commands: Command[] = []
  let words: Word[] = []
  let text = ''
  let inWord = false
  let quoted = false
  let dynamic = false
  let unsafe: string | undefined
  let redirect: 'discard' | 'heredoc' | undefined
  let segStart = 0
  let cmdStart = 0
  let i = 0

  const flag = (reason: string) => {
    unsafe ??= reason
  }
  const endWord = () => {
    if (inWord) {
      if (redirect === 'heredoc') heredocs.push(text)
      else if (!redirect) words.push({ text, dynamic })
      redirect = undefined
    }
    text = ''
    inWord = false
    quoted = false
    dynamic = false
  }
  const endCommand = (at: number, next: number) => {
    endWord()
    redirect = undefined
    if (words.length > 0) commands.push({ words, raw: src.slice(cmdStart, at).trim() })
    words = []
    cmdStart = next
  }
  const endSegment = (at: number, next: number) => {
    endCommand(at, next)
    const raw = src.slice(segStart, at).trim()
    if (commands.length > 0) segments.push(unsafe ? { raw, commands, unsafe } : { raw, commands })
    commands = []
    unsafe = undefined
    segStart = next
  }
  const skipHeredocs = (from: number): number => {
    let p = from
    while (heredocs.length > 0) {
      const delim = heredocs.shift()!
      while (p < src.length) {
        const e = src.indexOf('\n', p)
        const line = src.slice(p, e < 0 ? src.length : e)
        p = e < 0 ? src.length : e + 1
        if (line.trim() === delim) break
      }
    }
    return p
  }

  while (i < src.length) {
    const c = src[i]!
    const n = src[i + 1]
    if (c === "'") {
      inWord = true
      quoted = true
      const end = src.indexOf("'", i + 1)
      if (end < 0) {
        flag('unterminated quote')
        text += src.slice(i + 1)
        i = src.length
      } else {
        text += src.slice(i + 1, end)
        i = end + 1
      }
      continue
    }
    if (c === '"') {
      inWord = true
      quoted = true
      i++
      let closed = false
      while (i < src.length) {
        const d = src[i]!
        if (d === '"') {
          closed = true
          i++
          break
        }
        if (d === '\\' && i + 1 < src.length && '$`"\\\n'.includes(src[i + 1]!)) {
          text += src[i + 1]
          i += 2
          continue
        }
        if (d === '`') flag('command substitution')
        if (d === '$') {
          const e = src[i + 1] ?? ''
          if (e === '(') flag('command substitution')
          else if (e === '{' || NAME_START.test(e) || SPECIAL_PARAM.test(e)) dynamic = true
        }
        text += d
        i++
      }
      if (!closed) flag('unterminated quote')
      continue
    }
    if (c === '\\') {
      inWord = true
      quoted = true
      if (n !== undefined) text += n
      i += 2
      continue
    }
    if (c === '$') {
      const e = n ?? ''
      if (e === '(') flag('command substitution')
      else if (e === '{' || e === "'" || NAME_START.test(e) || SPECIAL_PARAM.test(e)) dynamic = true
      inWord = true
      text += c
      i++
      continue
    }
    if (c === '`') {
      flag('command substitution')
      inWord = true
      text += c
      i++
      continue
    }
    if (c === ' ' || c === '\t') {
      endWord()
      i++
      continue
    }
    if (c === '\n' || c === '\r') {
      endSegment(i, i + 1)
      i = heredocs.length > 0 ? skipHeredocs(i + 1) : i + 1
      segStart = i
      cmdStart = i
      continue
    }
    if (c === ';') {
      endSegment(i, i + 1)
      i++
      continue
    }
    if (c === '&') {
      if (n === '&') {
        endSegment(i, i + 2)
        i += 2
      } else if (n === '>') {
        endWord()
        i += src[i + 2] === '>' ? 3 : 2
        redirect = 'discard'
      } else {
        endSegment(i, i + 1)
        i++
      }
      continue
    }
    if (c === '|') {
      if (n === '|') {
        endSegment(i, i + 2)
        i += 2
      } else {
        const step = n === '&' ? 2 : 1
        endCommand(i, i + step)
        i += step
      }
      continue
    }
    if (c === '<' || c === '>') {
      if (inWord && !quoted && /^\d+$/.test(text)) {
        text = ''
        inWord = false
      }
      endWord()
      if (n === '(') {
        flag('process substitution')
        i += 2
        continue
      }
      if (c === '<' && n === '<') {
        if (src[i + 2] === '<') {
          flag('here-string')
          i += 3
          redirect = 'discard'
        } else {
          flag('heredoc')
          i += src[i + 2] === '-' ? 3 : 2
          redirect = 'heredoc'
        }
        continue
      }
      i++
      if (src[i] === '>' || src[i] === '|' || (c === '<' && src[i] === '>')) i++
      if (src[i] === '&') {
        i++
        const fdStart = i
        while (i < src.length && /[0-9-]/.test(src[i]!)) i++
        if (i === fdStart) redirect = 'discard'
      } else {
        redirect = 'discard'
      }
      continue
    }
    if (c === '(' || c === ')') {
      flag('subshell')
      endWord()
      i++
      continue
    }
    if (c === '#' && !inWord) {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '*' || c === '?') dynamic = true
    inWord = true
    text += c
    i++
  }
  endSegment(src.length, src.length)
  return segments
}

const ENV_ASSIGN = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/

// Wrapper commands and the flags of theirs that take a value.
const WRAPPERS: Record<string, ReadonlySet<string>> = {
  sudo: new Set(['-u', '-g', '-p', '-C', '-h', '-U', '-r', '-t', '-D', '-T', '-R']),
  doas: new Set(['-u', '-C']),
  env: new Set(['-u', '-C', '-S']),
  time: new Set(['-f', '-o']),
  nohup: new Set(),
  command: new Set(),
  builtin: new Set(),
  exec: new Set(['-a']),
  nice: new Set(['-n']),
  timeout: new Set(['-s', '-k']),
  stdbuf: new Set(['-i', '-o', '-e']),
  corepack: new Set(),
  'cross-env': new Set(),
}

/** Lower-cased base name of a program, without a directory or a Windows extension. */
export const program = (text: string): string =>
  text.replace(/^.*[/\\]/, '').replace(/\.(?:exe|cmd|bat|ps1)$/i, '').toLowerCase()

const skipFlags = (words: Word[], from: number, valued: ReadonlySet<string>): number => {
  let i = from
  while (i < words.length) {
    const s = words[i]!.text
    if (s.length < 2 || !s.startsWith('-')) break
    i += s === '--' ? 1 : valued.has(s) ? 2 : 1
    if (s === '--') break
  }
  return i
}

/** Strips env-var prefixes and wrappers (`sudo`, `env`, `time`…) and normalises the program name. */
export const unwrap = (words: Word[]): Invocation => {
  const env: Record<string, string> = {}
  let i = 0
  while (i < words.length) {
    const w = words[i]!
    const m = ENV_ASSIGN.exec(w.text)
    if (m) {
      env[m[1]!] = m[2]!
      i++
      continue
    }
    const name = program(w.text)
    const valued = WRAPPERS[name]
    if (!valued) break
    i = skipFlags(words, i + 1, valued)
    if (name === 'timeout' && i < words.length) i++
  }
  const rest = words.slice(i)
  if (rest[0]) rest[0] = { ...rest[0], text: program(rest[0].text) }
  return { words: rest, env }
}
