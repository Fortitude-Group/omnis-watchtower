// Benign corpus (SC-002 CI subset): the 50 + 50 recorded top packages plus the named set.

import type { PackageFacts } from '../../src/plugin/core/model'
import { benignNpm, benignPypi } from '../fixtures/http/benign-names'
import { gather } from './gather'

export const namedNpm = ['chalk', 'lodash', 'express', 'react', 'zod']
export const namedPypi = ['requests', 'numpy', 'pyyaml']

export const loadBenign = async (): Promise<PackageFacts[]> =>
  gather([
    ...[...benignNpm, ...namedNpm].map(name => ({ ecosystem: 'npm' as const, name })),
    ...[...benignPypi, ...namedPypi].map(name => ({ ecosystem: 'pypi' as const, name })),
  ])
