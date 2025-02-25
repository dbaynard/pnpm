import { type PassThrough } from 'stream'
import type { DeferredManifestPromise, FilesIndex, FileWriteResult } from '@pnpm/cafs-types'
import { type DependencyManifest } from '@pnpm/types'
import gunzip from 'gunzip-maybe'
import safePromiseDefer, { type SafePromiseDefer } from 'safe-promise-defer'
import tar from 'tar-stream'
import { parseJsonStream } from './parseJson'

export async function addFilesFromTarball (
  addStreamToCafs: (fileStream: PassThrough, mode: number) => Promise<FileWriteResult>,
  _ignore: null | ((filename: string) => boolean),
  stream: NodeJS.ReadableStream,
  manifest?: DeferredManifestPromise
): Promise<FilesIndex> {
  const ignore = _ignore ?? (() => false)
  const extract = tar.extract({ allowUnknownFormat: true })
  const filesIndex: FilesIndex = {}
  let unpipeManifestStream: () => void
  let lastManifest: SafePromiseDefer<DependencyManifest | undefined> | undefined
  await new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, fileStream, next) => {
      // There are some edge cases, where the same files are extracted multiple times.
      // So there will be an entry for "lib/index.js" and another one for "lib//index.js",
      // which are the same file.
      // Hence, we are normalizing the file name, replacing // with /.
      // When there are duplicate files, the last instances are picked.
      // Example of such package: @pnpm/colorize-semver-diff@1.0.1
      const filename = header.name.slice(header.name.indexOf('/') + 1).replace(/\/\//g, '/')
      if (header.type !== 'file' || ignore(filename)) {
        fileStream.resume()
        next()
        return
      }
      if (filename === 'package.json' && (manifest != null)) {
        unpipeManifestStream?.()
        lastManifest = safePromiseDefer<DependencyManifest | undefined>()
        unpipeManifestStream = parseJsonStream(fileStream, lastManifest)
      }
      const writeResult = addStreamToCafs(fileStream, header.mode!)
      filesIndex[filename] = {
        mode: header.mode!,
        size: header.size!,
        writeResult,
      }
      next()
    })
    // listener
    extract.on('finish', () => {
      resolve()
    })
    extract.on('error', reject)

    // pipe through extractor
    stream
      .on('error', reject)
      .pipe(gunzip())
      .on('error', reject).pipe(extract)
  })
  if (!filesIndex['package.json'] && manifest != null) {
    manifest.resolve(undefined)
  } else if (lastManifest && manifest) {
    lastManifest().then(manifest.resolve).catch(manifest.reject)
  }
  return filesIndex
}
