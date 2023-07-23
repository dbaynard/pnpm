import { createCafs, getFilePathByModeInCafs } from '@pnpm/cafs'
import { type DependencyManifest } from '@pnpm/types'
import { parentPort } from 'worker_threads'
import { Readable } from 'stream'
import safePromiseDefer from 'safe-promise-defer'

parentPort!.on('message', handleMessage)

interface TarballExtractMessage {
  type: 'extract'
  buffer: Buffer
  cafsDir: string
}

let cafs: any

async function handleMessage (message: TarballExtractMessage | false): Promise<void> {
  if (message === false) {
    parentPort!.off('message', handleMessage)
    process.exit(0)
  }

  try {
    switch (message.type) {
      case 'extract':
        const { buffer, cafsDir } = message;
        if (!cafs) {
          cafs = createCafs(cafsDir)
        }
        const streamForTarball = new Readable({
          read () {
            this.push(buffer)
            this.push(null)
          },
        })
        const manifest = safePromiseDefer<DependencyManifest | undefined>()
        const filesIndex = await cafs.addFilesFromTarball(streamForTarball, manifest)
        const filesMap = Object.fromEntries(await Promise.all(Object.entries(filesIndex).map(async ([k, v]: [any, any]) => {
          const { integrity } = await v.writeResult
          return [k, getFilePathByModeInCafs(cafsDir, integrity, v.mode)]
        })))
        parentPort!.postMessage({ status: 'success', value: { filesIndex: filesMap, manifest: await manifest() }})
        return
    }
  } catch (e: any) {
    console.log('ERRRRR', e)
    parentPort!.postMessage({ status: 'error', error: e.toString() })
  }
}
