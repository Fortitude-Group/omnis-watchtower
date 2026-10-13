import { describe, expect, it } from 'vitest'
import {
  emptyConfig, isPublicRegistry, loadPrivateConfig, matchesAllowlist, NPM_PUBLIC, parseAllowlist,
  parseNpmrc, parsePipConf, PYPI_PUBLIC, resolvePackage,
} from '../../src/plugin/adapters/project-config'
import type { PrivateConfig } from '../../src/plugin/adapters/project-config'

describe('parseNpmrc', () => {
  it('reads the default and scoped registries and ignores the rest', () => {
    const text = [
      '# company settings',
      'registry = "https://npm.acme.internal/"',
      '@Acme:registry=https://npm.acme.internal/private/',
      '//npm.acme.internal/:_authToken=${NPM_TOKEN}',
      '; save-exact=true',
      'save-exact=true',
    ].join('\r\n')
    expect(parseNpmrc(text)).toEqual({
      registry: 'https://npm.acme.internal/',
      scopes: { '@acme': 'https://npm.acme.internal/private/' },
    })
  })
})

describe('parsePipConf', () => {
  it('reads index-url and multi-line extra-index-url, with [install] over [global]', () => {
    const text = [
      '[global]',
      'index-url = https://pypi.org/simple',
      'extra-index-url =',
      '    https://pkgs.acme.internal/simple',
      '    https://mirror.acme.internal/simple',
      'timeout: 60',
      '[install]',
      'index_url: https://proxy.acme.internal/simple/',
      '[freeze]',
      'index-url = https://ignored.example/simple',
    ].join('\n')
    expect(parsePipConf(text)).toEqual({
      indexUrl: 'https://proxy.acme.internal/simple/',
      extraIndexUrls: ['https://pkgs.acme.internal/simple', 'https://mirror.acme.internal/simple'],
    })
  })

  it('returns no index when none is set', () => {
    expect(parsePipConf('[global]\ntimeout = 5')).toEqual({ extraIndexUrls: [] })
  })
})

describe('registries and the allowlist', () => {
  it('knows the public registries whatever the spelling', () => {
    expect(isPublicRegistry('npm', 'https://registry.npmjs.org')).toBe(true)
    expect(isPublicRegistry('npm', 'HTTPS://REGISTRY.NPMJS.ORG/')).toBe(true)
    expect(isPublicRegistry('pypi', 'https://pypi.org/simple/')).toBe(true)
    expect(isPublicRegistry('pypi', 'https://user:pw@pypi.org/simple')).toBe(true)
    expect(isPublicRegistry('npm', 'https://npm.acme.internal/')).toBe(false)
    expect(isPublicRegistry('pypi', 'https://pypi.org.evil.example/simple')).toBe(false)
  })

  it('splits the setting and matches globs per ecosystem', () => {
    const patterns = parseAllowlist(' @acme/*, acme-*,pypi:Internal_*  ')
    expect(patterns).toEqual(['@acme/*', 'acme-*', 'pypi:Internal_*'])
    expect(matchesAllowlist({ ecosystem: 'npm', name: '@acme/widgets' }, patterns)).toBe(true)
    expect(matchesAllowlist({ ecosystem: 'npm', name: '@acmex/widgets' }, patterns)).toBe(false)
    expect(matchesAllowlist({ ecosystem: 'pypi', name: 'Acme_Tools' }, patterns)).toBe(true)
    expect(matchesAllowlist({ ecosystem: 'pypi', name: 'internal.auth' }, patterns)).toBe(true)
    expect(matchesAllowlist({ ecosystem: 'npm', name: 'internal-auth' }, patterns)).toBe(false)
    expect(matchesAllowlist({ ecosystem: 'npm', name: 'chalk' }, patterns)).toBe(false)
  })
})

describe('resolvePackage', () => {
  const config = (patch: (c: PrivateConfig) => void) => {
    const c = emptyConfig()
    patch(c)
    return c
  }

  it('is public with the default configuration', () => {
    expect(resolvePackage({ ecosystem: 'npm', name: 'chalk' }, emptyConfig())).toEqual({ kind: 'public' })
    expect(resolvePackage({ ecosystem: 'pypi', name: 'requests' }, emptyConfig())).toEqual({ kind: 'public' })
  })

  it('is private for a scope mapped to a private registry', () => {
    const c = config(c => { c.npm.scopes['@acme'] = 'https://npm.acme.internal/' })
    expect(resolvePackage({ ecosystem: 'npm', name: '@acme/widgets' }, c))
      .toEqual({ kind: 'private', registry: 'https://npm.acme.internal/', via: 'scope' })
    expect(resolvePackage({ ecosystem: 'npm', name: '@other/widgets' }, c)).toEqual({ kind: 'public' })
  })

  it('is private for an allowlisted name, naming the private registry when there is one', () => {
    const c = config(c => {
      c.allowlist = ['acme-*']
      c.pypi.extraIndexUrls = ['https://pkgs.acme.internal/simple']
    })
    expect(resolvePackage({ ecosystem: 'npm', name: 'acme-ui' }, c)).toEqual({ kind: 'private', registry: 'allowlist', via: 'allowlist' })
    expect(resolvePackage({ ecosystem: 'pypi', name: 'acme-auth' }, c))
      .toEqual({ kind: 'private', registry: 'https://pkgs.acme.internal/simple', via: 'allowlist' })
  })

  it('treats a non-public default index or a private extra index as a mirror', () => {
    const c = config(c => {
      c.npm.registry = 'https://proxy.acme.internal/npm/'
      c.pypi.extraIndexUrls = ['https://pkgs.acme.internal/simple']
    })
    expect(resolvePackage({ ecosystem: 'npm', name: 'chalk' }, c)).toEqual({ kind: 'mirror', registry: 'https://proxy.acme.internal/npm/' })
    expect(resolvePackage({ ecosystem: 'pypi', name: 'requests' }, c)).toEqual({ kind: 'mirror', registry: 'https://pkgs.acme.internal/simple' })
  })
})

describe('loadPrivateConfig', () => {
  const sources = (files: Record<string, string>, env: Record<string, string> = {}) => ({
    readFile: async (path: string) => files[path],
    env: (name: string) => env[name],
  })

  it('returns the public defaults when nothing is configured', async () => {
    expect(await loadPrivateConfig({ ...sources({}), cwd: '/proj', home: '/home/me' })).toEqual({
      npm: { registry: NPM_PUBLIC, scopes: {} },
      pypi: { indexUrl: PYPI_PUBLIC, extraIndexUrls: [] },
      allowlist: [],
    })
  })

  it('lets the project .npmrc override the user one, scope by scope', async () => {
    const config = await loadPrivateConfig({
      ...sources({
        '/proj/.npmrc': '@acme:registry=https://project.acme/\n',
        '/home/me/.npmrc': 'registry=https://user.acme/\n@acme:registry=https://user.acme/acme/\n@tools:registry=https://user.acme/tools/',
      }),
      cwd: '/proj/',
      home: '/home/me',
      allowlist: '@acme/*',
    })
    expect(config.npm).toEqual({
      registry: 'https://user.acme/',
      scopes: { '@acme': 'https://project.acme/', '@tools': 'https://user.acme/tools/' },
    })
    expect(config.allowlist).toEqual(['@acme/*'])
  })

  it('ranks the command line over the environment over files', async () => {
    const files = {
      '/home/me/.config/pip/pip.conf': '[global]\nindex-url = https://file.acme/simple\nextra-index-url = https://extra.acme/simple',
      '/proj/.npmrc': 'registry=https://file.acme/npm/',
    }
    const env = { HOME: '/home/me', PIP_INDEX_URL: 'https://env.acme/simple', npm_config_registry: 'https://env.acme/npm/' }
    const fromEnv = await loadPrivateConfig({ ...sources(files, env), cwd: '/proj' })
    expect(fromEnv.pypi).toEqual({ indexUrl: 'https://env.acme/simple', extraIndexUrls: ['https://extra.acme/simple'] })
    expect(fromEnv.npm.registry).toBe('https://env.acme/npm/')

    const fromFlags = await loadPrivateConfig({
      ...sources(files, env),
      cwd: '/proj',
      indexUrls: { pypi: ['https://flag.acme/simple', 'https://flag-extra.acme/simple'], npm: ['https://flag.acme/npm/'] },
    })
    expect(fromFlags.pypi).toEqual({
      indexUrl: 'https://flag.acme/simple',
      extraIndexUrls: ['https://extra.acme/simple', 'https://flag-extra.acme/simple'],
    })
    expect(fromFlags.npm.registry).toBe('https://flag.acme/npm/')
  })

  it('reads pip.ini under APPDATA and the project, and survives a failing reader', async () => {
    const config = await loadPrivateConfig({
      readFile: async path => {
        if (path === 'C:/Users/me/AppData/Roaming/pip/pip.ini') return '[global]\nextra-index-url = https://appdata.acme/simple'
        if (path === 'C:/proj/pip.ini') return '[global]\nindex-url = https://project.acme/simple'
        throw new Error('EACCES')
      },
      env: name => ({ APPDATA: 'C:/Users/me/AppData/Roaming', USERPROFILE: 'C:/Users/me' } as Record<string, string>)[name],
      cwd: 'C:/proj',
    })
    expect(config.pypi).toEqual({ indexUrl: 'https://project.acme/simple', extraIndexUrls: ['https://appdata.acme/simple'] })
  })
})

it('the gate hook answers every environment variable the loader reads', async () => {
  const { readFileSync } = await import('node:fs')
  const { CONFIG_ENV_NAMES, loadPrivateConfig } = await import('../../src/plugin/adapters/project-config')
  const gate = readFileSync('src/plugin/hooks/gate.ts', 'utf8')
  for (const name of CONFIG_ENV_NAMES) expect(gate).toContain(`case '${name}': return $.env.get('${name}')`)
  const asked = new Set<string>()
  await loadPrivateConfig({ readFile: async () => undefined, env: n => { asked.add(n); return undefined }, cwd: '.' })
  for (const name of asked) expect(CONFIG_ENV_NAMES as readonly string[]).toContain(name)
})
