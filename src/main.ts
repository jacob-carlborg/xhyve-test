import * as core from '@actions/core'
import * as cache from '@actions/tool-cache'
import * as path from 'path'
import * as fs from 'fs'
import * as exec from '@actions/exec'
import {spawn} from 'child_process'
import { resourceLimits } from 'worker_threads'

async function execWithOutput(
  commandLine: string,
  args?: string[]
): Promise<string> {
  let output!: string

  const exitCode = await exec.exec('./run.sh', args, {
    listeners: {
      stdout: buffer => (output += buffer.toString())
    }
  })

  if (exitCode !== 0)
    throw Error(`Failed to executed command: ${commandLine} ${args?.join(' ')}`)

  return output
}

export class XhyveVm {
  macAddress!: string
  ipAddress!: string

  async init(): Promise<void> {
    this.macAddress = await this.getMacAddress()
  }

  run(): void {
    spawn('./run.sh', {detached: true})
  }

  stop(): void {
    this.execute('shutdown -h -ph now')
  }

  async execute(command: string): Promise<void> {
    const buffer = Buffer.from(command)
    await exec.exec('ssh', ['-i', 'id_ed25519', `root@${this.ipAddress}`], {
      input: buffer
    })
  }

  async getMacAddress(): Promise<string> {
    return (this.macAddress = await execWithOutput('./run.sh'))
  }

  extractIpAddress(arpOutput: string, macAddress: string): string | undefined {
    const result = arpOutput
      .split("\n")
      .find(e => e.includes(macAddress))
      ?.match(/\((.+)\)/);

    return result ? result[1] : undefined;
  }
}

class Action {
  private readonly resourceUrl =
    'https://github.com/jacob-carlborg/xhyve-test/releases/download/qcow2/resources.tar'

  async run(): Promise<void> {
    const resourcesArchivePath = await this.downloadResources()
    const resourcesDirectory = await this.unarchiveResoruces(
      resourcesArchivePath
    )
    this.configSSH()
    await this.convertToRawDisk()
    const vm = new XhyveVm()
    await vm.init()
    vm.run()
  }

  async downloadResources(): Promise<string> {
    core.info(`Downloading resources: ${this.resourceUrl}`)
    return await cache.downloadTool(this.resourceUrl)
  }

  async unarchiveResoruces(resourcesArchivePath: string): Promise<string> {
    core.info(`Unarchiving resoruces: ${resourcesArchivePath}`)
    return cache.extractTar(resourcesArchivePath)
  }

  configSSH(): void {
    const homeDirectory = process.env['HOME']

    if (homeDirectory === undefined) throw Error('Failed to get the home direcory')

    const sshDirectory = path.join(homeDirectory, '.ssh')
    fs.appendFileSync(
      path.join(sshDirectory, 'config'),
      'StrictHostKeyChecking=accept-new'
    )
    fs.chmodSync('id_ed25519', '0o600')
    fs.chmodSync(sshDirectory, '0o600')
  }

  async convertToRawDisk(): Promise<void> {
    await exec.exec('./qemu-img', [
      'convert',
      '-f',
      'qcow2',
      '-O',
      'raw',
      'disk.qcow2',
      'disk.raw'
    ])
  }
}

async function main(): Promise<void> {
  try {
    new Action().run()
  } catch (error) {
    core.setFailed(error.message)
  }
}

//main()
