import { PnpmError } from '@pnpm/error'
import {
  type FetchFunction,
  type FetchOptions,
} from '@pnpm/fetcher-base'
import type { Cafs } from '@pnpm/cafs-types'
import {
  type FetchFromRegistry,
  type GetAuthHeader,
  type RetryTimeoutOptions,
} from '@pnpm/fetching-types'
import { WorkerPool } from '@rushstack/worker-pool/lib/WorkerPool'
import {
  createDownloader,
  type DownloadFunction,
  TarballIntegrityError,
} from './remoteTarballFetcher'
import { createLocalTarballFetcher } from './localTarballFetcher'
import { createGitHostedTarballFetcher, waitForFilesIndex } from './gitHostedTarballFetcher'

export { BadTarballError } from './errorTypes'

export { TarballIntegrityError, waitForFilesIndex }

export interface TarballFetchers {
  localTarball: FetchFunction
  remoteTarball: FetchFunction
  gitHostedTarball: FetchFunction
}

export function createTarballFetcher (
  fetchFromRegistry: FetchFromRegistry,
  getAuthHeader: GetAuthHeader,
  opts: {
    cafsDir: string
    rawConfig: object
    unsafePerm?: boolean
    ignoreScripts?: boolean
    timeout?: number
    retry?: RetryTimeoutOptions
    offline?: boolean
  }
): TarballFetchers {
  const workerPool = new WorkerPool({
    id: 'tarball',
    maxWorkers: 16,
    workerScriptPath: '/Users/zoltan/src/pnpm/pnpm/fetching/tarball-fetcher/lib/worker/tarballWorker.js',
  })
  // @ts-ignore
  global.finishWorkers = () => {
    workerPool.finishAsync()
  }
  const download = createDownloader(workerPool, opts.cafsDir, fetchFromRegistry, {
    retry: opts.retry,
    timeout: opts.timeout,
  })

  const remoteTarballFetcher = fetchFromTarball.bind(null, {
    download,
    getAuthHeaderByURI: getAuthHeader,
    offline: opts.offline,
  }) as FetchFunction

  return {
    localTarball: createLocalTarballFetcher(),
    remoteTarball: remoteTarballFetcher,
    gitHostedTarball: createGitHostedTarballFetcher(remoteTarballFetcher, opts),
  }
}

async function fetchFromTarball (
  ctx: {
    download: DownloadFunction
    getAuthHeaderByURI: (registry: string) => string | undefined
    offline?: boolean
  },
  cafs: Cafs,
  resolution: {
    integrity?: string
    registry?: string
    tarball: string
  },
  opts: FetchOptions
) {
  if (ctx.offline) {
    throw new PnpmError('NO_OFFLINE_TARBALL',
      `A package is missing from the store but cannot download it in offline mode. The missing package may be downloaded from ${resolution.tarball}.`)
  }
  return ctx.download(resolution.tarball, {
    getAuthHeaderByURI: ctx.getAuthHeaderByURI,
    cafs,
    integrity: resolution.integrity,
    manifest: opts.manifest,
    onProgress: opts.onProgress,
    onStart: opts.onStart,
    registry: resolution.registry,
  })
}
