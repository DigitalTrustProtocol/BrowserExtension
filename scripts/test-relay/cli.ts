import { startConsole } from './control/console.ts'
import { TestRelayCluster } from './cluster.ts'

interface CliOptions {
  port: number
  relays: number
  seed: string
  verify: boolean
  personas: number
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const cluster = await TestRelayCluster.start(options)
  const stop = async (): Promise<void> => {
    await cluster.close()
  }
  process.on('SIGINT', () => {
    void stop().then(() => process.exit(0))
  })
  console.log('AttentionX test relay. Localhost only. Not for production.')
  for (const url of cluster.urls) console.log(`listening ${url}`)
  console.log(
    `admin http://127.0.0.1:${cluster.hosts[0]?.port}/admin  verify ${options.verify ? 'on' : 'off'}  seed ${options.seed}`,
  )
  console.log('Type help. Import keys operator a|b only into a test profile.')
  if (process.stdin.isTTY) {
    await startConsole(cluster)
  } else {
    await new Promise<void>((resolve) => {
      cluster.onQuit = resolve
    })
  }
  await stop()
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    port: 7777,
    relays: 1,
    seed: 'attentionx',
    verify: true,
    personas: 16,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--no-verify') {
      options.verify = false
      continue
    }
    const value = argv[index + 1]
    if (arg === '--port' && value) {
      options.port = Number(value)
      index += 1
    } else if (arg === '--relays' && value) {
      options.relays = Math.max(1, Number(value))
      index += 1
    } else if (arg === '--seed' && value) {
      options.seed = value
      index += 1
    } else if (arg === '--personas' && value) {
      options.personas = Number(value)
      index += 1
    } else if (arg === '--help') {
      console.log(
        'npm run relay -- [--port 7777] [--relays 1] [--seed attentionx] [--personas 16] [--no-verify]',
      )
      process.exit(0)
    }
  }
  return options
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
