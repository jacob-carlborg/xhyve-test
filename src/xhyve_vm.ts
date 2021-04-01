import * as core from '@actions/core'
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

export abstract class Vm {
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

  static getVm(type: Type): typeof FreeBsd {
    core.debug(`Vm.getVm: ${type}`)
    switch (type) {
      case Type.freeBsd:
        return FreeBsd
    }
  }

  async init(): Promise<void> {
    core.info('Initializing VM')
    this.macAddress = await this.getMacAddress()
  }

  async run(): Promise<void> {
    core.info('Booting VM')
    spawn('sudo', this.xhyveArgs, {detached: true})
    this.ipAddress = await getIpAddressFromArp(this.macAddress)
  }

  async wait(timeout: number): Promise<void> {
    core.info('Waiting for VM be ready')

    for (let index = 0; index < timeout; index++) {
      const result = await this.execute('true', {
        log: false,
        silent: true,
        ignoreReturnCode: true
      })

      if (result === 0) {
        core.info('VM is ready')
        return
      }
      await wait(1000)
    }

    throw Error(
      `Waiting for VM to become ready timed out after ${timeout} seconds`
    )
  }

  async stop(): Promise<void> {
    core.info('Shuting down VM')
    await this.shutdown()
  }

  async shutdown(): Promise<void> {
    throw Error('Not implemented')
  }

  async execute(
    command: string,
    options: ExecuteOptions = {}
  ): Promise<number> {
    if (options.log) core.info(`Executing command inside VM: ${command}`)
    const buffer = Buffer.from(command)

    return await exec.exec(
      `ssh -t -i ${this.sshKey} root@${this.ipAddress}`,
      [],
      {
        input: buffer,
        silent: options.silent,
        ignoreReturnCode: options.ignoreReturnCode
      }
    )
  }

  async getMacAddress(): Promise<string> {
    core.debug('Getting MAC address')
    this.macAddress = (
      await execWithOutput('sudo', this.xhyveArgs.concat('-M'), {silent: true})
    )
      .trim()
      .slice(5)
    core.debug(`Found MAC address: '${this.macAddress}'`)
    return this.macAddress
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
  core.debug('Extracing IP address')
  const matchResult = arpOutput
    .split('\n')
    .find(e => e.includes(macAddress))
    ?.match(/\((.+)\)/)

  const ipAddress = matchResult ? matchResult[1] : undefined

  if (ipAddress) core.info(`Found IP address: '${ipAddress}'`)

  return ipAddress
}

export async function execWithOutput(
  commandLine: string,
  args?: string[],
  options: ExecuteOptions = {}
): Promise<string> {
  let output = ''

  const exitCode = await exec.exec(commandLine, args, {
    silent: options.silent,
    ignoreReturnCode: options.ignoreReturnCode,
    listeners: {
      stdout: buffer => (output += buffer.toString())
    }
  })

  if (exitCode !== 0)
    throw Error(`Failed to executed command: ${commandLine} ${args?.join(' ')}`)

  return output.toString()
}

interface ExecuteOptions {
  log?: boolean
  ignoreReturnCode?: boolean
  silent?: boolean
}

class FreeBsd extends Vm {
  get xhyveArgs(): string[] {
    // prettier-ignore
    return super.xhyveArgs.concat(
      '-f', `fbsd,${this.options.userboot},${this.options.diskImage},`
    )
  }

  async shutdown(): Promise<void> {
    await this.execute('shutdown -p now')
  }
}

async function getIpAddressFromArp(macAddress: string): Promise<string> {
  core.info(`Getting IP address for MAC address: '${macAddress}'`)
  for (let i = 0; i < 500; i++) {
    const arpOutput = await execWithOutput('arp', ['-a', '-n'], {silent: true})
    const ipAddress = extractIpAddress(arpOutput, macAddress)

    if (ipAddress) return ipAddress

    await wait(1_000)
  }

  throw Error(`Failed to get IP address for MAC address: ${macAddress}`)
}
