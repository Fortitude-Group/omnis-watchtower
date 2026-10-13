// Benign corpus (SC-002 CI subset): the 50 + 50 recorded top packages plus the named set.

import type { Ecosystem, PackageFacts } from '../../src/plugin/core/model'
import { benignNpm, benignPypi } from '../fixtures/http/benign-names'
import { factsFromFixtures } from './facts-from-fixtures'

export const namedNpm = ['chalk', 'lodash', 'express', 'react', 'zod']
export const namedPypi = ['requests', 'numpy', 'pyyaml']

const all = (e: Ecosystem, names: string[]): PackageFacts[] => names.map(n => factsFromFixtures(e, n))

export const benign: PackageFacts[] = [
  ...all('npm', [...benignNpm, ...namedNpm]),
  ...all('pypi', [...benignPypi, ...namedPypi]),
]

/** Popular lists for the corpus: the benign names themselves, most popular first. */
export const corpusPopularNpm = [...benignNpm, ...namedNpm]
export const corpusPopularPypi = [...benignPypi, ...namedPypi]
