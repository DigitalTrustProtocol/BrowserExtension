import readline from 'node:readline'
import type { TestRelayCluster } from '../cluster.ts'

/** Readline console. Resolves when the operator quits or the input closes. */
export function startConsole(cluster: TestRelayCluster): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  rl.setPrompt('relay> ')
  rl.prompt()
  return new Promise((resolve) => {
    let closed = false
    const finish = (): void => {
      if (closed) return
      closed = true
      rl.close()
      resolve()
    }
    cluster.onQuit = finish
    rl.on('line', (line) => {
      void cluster.command(line).then((result) => {
        for (const row of result.lines) console.log(row)
        if (!closed) rl.prompt()
      })
    })
    rl.on('close', finish)
  })
}
