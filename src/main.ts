import * as core from '@actions/core'
import * as cache from '@actions/tool-cache'
import * as path from 'path'
import * as fs from 'fs'
import * as exec from '@actions/exec'
import {spawn} from 'child_process'

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

interface VmOptions {
  memory: string
  uuid: string
  diskImage: fs.PathLike
  cpuCount: number
  userboot: fs.PathLike
}

const enum VmType {
  freeBsd
}

export class XhyveVm {
  macAddress!: string
  ipAddress!: string
  private sshKey: fs.PathLike
  private xhyvePath: fs.PathLike
  protected options: VmOptions

  constructor(sshKey: fs.PathLike, xhyvePath: fs.PathLike, options: VmOptions) {
    this.sshKey = sshKey
    this.xhyvePath = xhyvePath
    this.options = options
  }

  static getVm(type: VmType): typeof XhyveVm {
    switch (type) {
      case VmType.freeBsd:
        return FreeBsd
    }
  }

  async init(): Promise<void> {
    this.macAddress = await this.getMacAddress()
  }

  run(): void {
    spawn('sudo', this.xhyveArgs, {detached: true})
  }

  stop(): void {
    this.execute('shutdown -h -p now')
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

  extractIpAddress(arpOutput: string, macAddress: string): string | undefined {
    const result = arpOutput
      .split('\n')
      .find(e => e.includes(macAddress))
      ?.match(/\((.+)\)/)

    return result ? result[1] : undefined
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

class FreeBsd extends XhyveVm {
  get xhyveArgs(): string[] {
    return super.xhyveArgs.concat(
      `-f fbsd,${this.options.userboot},${this.options.diskImage},`
    )
  }
}

class Action {
  private readonly resourceUrl =
    'https://github.com/jacob-carlborg/xhyve-test/releases/download/qcow2/resources.tar'

  private readonly targetDiskName = 'disk.raw'

  async run(): Promise<void> {
    const resourcesArchivePath = await this.downloadResources()
    const resourcesDirectory = await this.unarchiveResoruces(
      resourcesArchivePath
    )
    const sshKeyPath = path.join(resourcesDirectory, 'id_ed25519')
    this.configSSH(sshKeyPath)
    await this.convertToRawDisk(resourcesDirectory)
    const VmClass = XhyveVm.getVm(VmType.freeBsd)
    const vm = new VmClass(sshKeyPath, path.join(resourcesDirectory, 'xhyve'), {
      memory: '4G',
      cpuCount: 2,
      diskImage: path.join(resourcesDirectory, this.targetDiskName),
      uuid: '864ED7F0-7876-4AA7-8511-816FABCFA87F',
      userboot: path.join(resourcesDirectory, 'userboot.so')
    })
    await vm.init()
    vm.run()
  }

  async downloadResources(): Promise<string> {
    core.info(`Downloading resources: ${this.resourceUrl}`)
    return await cache.downloadTool(this.resourceUrl)
  }

  async unarchiveResoruces(resourcesArchivePath: string): Promise<string> {
    core.info(`Unarchiving resoruces: ${resourcesArchivePath}`)
    return cache.extractTar(resourcesArchivePath, undefined, '-x')
  }

  configSSH(sshKey: fs.PathLike): void {
    const homeDirectory = process.env['HOME']

    if (homeDirectory === undefined)
      throw Error('Failed to get the home direcory')

    const sshDirectory = path.join(homeDirectory, '.ssh')
    fs.mkdirSync(sshDirectory, {mode: 0o700})
    fs.appendFileSync(
      path.join(sshDirectory, 'config'),
      'StrictHostKeyChecking=accept-new'
    )

    fs.chmodSync(sshKey, 0o600)
  }

  async convertToRawDisk(resourcesDirectory: fs.PathLike): Promise<void> {
    const resDir = resourcesDirectory.toString()
    await exec.exec(path.join(resDir, 'qemu-img'), [
      'convert',
      '-f',
      'qcow2',
      '-O',
      'raw',
      path.join(resDir, 'disk.qcow2'),
      path.join(resDir, this.targetDiskName)
    ])
  }
}

async function main(): Promise<void> {
  try {
    await new Action().run()
  } catch (error) {
    core.setFailed(error.message)
  }
}

main()
