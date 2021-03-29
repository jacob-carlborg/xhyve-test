import * as exec from '@actions/exec'
import * as fs from 'fs'
import {spawn} from 'child_process'
import {wait} from './wait'

export interface Options {
  memory: string
  uuid: string
  diskImage: fs.PathLike
  cpuCount: number
  userboot: fs.PathLike
}

export const enum Type {
  freeBsd
}

export class Vm {
  macAddress!: string
  ipAddress!: string
  private sshKey: fs.PathLike
  private xhyvePath: fs.PathLike
  protected options: Options

  constructor(sshKey: fs.PathLike, xhyvePath: fs.PathLike, options: Options) {
    this.sshKey = sshKey
    this.xhyvePath = xhyvePath
    this.options = options
  }

  static getVm(type: Type): typeof Vm {
    switch (type) {
      case Type.freeBsd:
        return FreeBsd
    }
  }

  async init(): Promise<void> {
    this.macAddress = await this.getMacAddress()
  }

  async run(): Promise<void> {
    spawn('sudo', this.xhyveArgs, {detached: true})
    this.ipAddress = await getIpAddressFromArp(this.macAddress)
  }

  async stop(): Promise<void> {
    await this.execute('shutdown -h -p now')
  }

  async execute(command: string): Promise<void> {
    const buffer = Buffer.from(command)
    await exec.exec(
      'ssh',
      ['-i', this.sshKey.toString(), `root@${this.ipAddress}`],
      {
        input: buffer
      }
    )
  }

  async getMacAddress(): Promise<string> {
    return (this.macAddress = await execWithOutput(
      'sudo',
      this.xhyveArgs.concat('-M')
    ))
  }

  get xhyveArgs(): string[] {
    // prettier-ignore
    return [
        this.xhyvePath.toString(),
        '-U', this.options.uuid,
        '-A',
        '-H',
        '-m', this.options.memory,
        '-c', this.options.cpuCount.toString(),
        '-s', '0:0,hostbridge',
        '-s', '2:0,virtio-net',
        '-s', `4:0,virtio-blk,${this.options.diskImage}`,
        '-s', '31,lpc',
        '-l', 'com1,stdio'
      ]
  }
}

export function extractIpAddress(
  arpOutput: string,
  macAddress: string
): string | undefined {
  const result = arpOutput
    .split('\n')
    .find(e => e.includes(macAddress))
    ?.match(/\((.+)\)/)

  return result ? result[1] : undefined
}

class FreeBsd extends Vm {
  get xhyveArgs(): string[] {
    return super.xhyveArgs.concat(
      `-f fbsd,${this.options.userboot},${this.options.diskImage},`
    )
  }
}

async function execWithOutput(
  commandLine: string,
  args?: string[]
): Promise<string> {
  let output!: string

  const exitCode = await exec.exec(commandLine, args, {
    listeners: {
      stdout: buffer => (output += buffer.toString())
    }
  })

  if (exitCode !== 0)
    throw Error(`Failed to executed command: ${commandLine} ${args?.join(' ')}`)

  return output
}

async function getIpAddressFromArp(macAddress: string): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const arpOutput = await execWithOutput('arp', ['-a', '-n'])
    const ipAddress = extractIpAddress(arpOutput, macAddress)

    if (ipAddress) return ipAddress

    await wait(1_000)
  }

  throw Error(`Failed to get IP address for MAC address: ${macAddress}`)
}
