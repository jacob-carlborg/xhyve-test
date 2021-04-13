import * as fs from 'fs'
import * as path from 'path'

import * as cache from '@actions/tool-cache'
import * as core from '@actions/core'
import * as exec from '@actions/exec'

import * as xhyve from './xhyve_vm'
import {execWithOutput} from './utility'

export default class Action {
  private readonly resourceUrl =
    'https://github.com/jacob-carlborg/xhyve-test/releases/download/qcow2/resources.tar'

  private readonly diskImageUrl =
    'https://github.com/jacob-carlborg/xhyve-test/releases/download/qcow2/disk.qcow2'

  private readonly targetDiskName = 'disk.raw'
  private readonly tempPath: string
  private readonly privateSshKey: fs.PathLike
  private readonly publicSshKey: fs.PathLike
  private readonly resourceDisk: ResourceDisk

  constructor() {
    this.tempPath = fs.mkdtempSync('resources')
    this.privateSshKey = path.join(this.tempPath, 'ed25519')
    this.publicSshKey = `${this.privateSshKey}.pub`
    this.resourceDisk = new ResourceDisk(this.tempPath)
  }

  async run(): Promise<void> {
    core.debug('Running action')
    const [diskImagePath, resourcesArchivePath] = await Promise.all([
      this.downloadDiskImage(),
      this.downloadResources(),
      this.setupSSHKey()
    ])

    const vm = await this.creareVm(resourcesArchivePath, diskImagePath)

    await vm.init()
    await vm.run()
    await vm.wait(10)
    await vm.execute('freebsd-version')
    // "sh -c 'cd $GITHUB_WORKSPACE && exec sh'"
    await vm.stop()
    fs.rmdirSync(this.tempPath, {recursive: true})
  }

  async downloadDiskImage(): Promise<string> {
    core.info(`Downloading disk image: ${this.diskImageUrl}`)
    const result = await cache.downloadTool(this.diskImageUrl)
    core.info(`Downloaded file: ${result}`)

    return result
  }

  async downloadResources(): Promise<string> {
    core.info(`Downloading resources: ${this.resourceUrl}`)
    const result = await cache.downloadTool(this.resourceUrl)
    core.info(`Downloaded file: ${result}`)

    return result
  }

  async creareVm(
    resourcesArchivePath: string,
    diskImagePath: string
  ): Promise<xhyve.Vm> {
    this.configSSH()
    const resourcesDirectory = await this.unarchiveResoruces(
      resourcesArchivePath
    )

    await this.convertToRawDisk(diskImagePath, resourcesDirectory)

    const xhyvePath = path.join(resourcesDirectory, 'xhyve')
    return xhyve.Vm.creareVm(
      xhyve.Type.freeBsd,
      this.privateSshKey,
      xhyvePath,
      {
        memory: '4G',
        cpuCount: 2,
        diskImage: path.join(resourcesDirectory, this.targetDiskName),
        uuid: '864ED7F0-7876-4AA7-8511-816FABCFA87F',
        userboot: path.join(resourcesDirectory, 'userboot.so'),
        firmware: path.join(resourcesDirectory, 'uefi.fd')
      }
    )
  }

  async setupSSHKey(): Promise<void> {
    const mountPath = await this.resourceDisk.create()
    await exec.exec('ssh-keygen', [
      '-t',
      'ed25519',
      '-f',
      this.privateSshKey.toString(),
      '-q',
      '-N',
      ''
    ])
    fs.renameSync(this.publicSshKey, path.join(mountPath, 'key'))
    this.resourceDisk.unmount()
  }

  async unarchiveResoruces(resourcesArchivePath: string): Promise<string> {
    core.info(`Unarchiving resoruces: ${resourcesArchivePath}`)
    return cache.extractTar(resourcesArchivePath, undefined, '-x')
  }

  configSSH(): void {
    core.debug('Configuring SSH')
    const homeDirectory = process.env['HOME']

    if (homeDirectory === undefined)
      throw Error('Failed to get the home direcory')

    const sshDirectory = path.join(homeDirectory, '.ssh')

    if (!fs.existsSync(sshDirectory))
      fs.mkdirSync(sshDirectory, {recursive: true, mode: 0o700})

    const lines = [
      'StrictHostKeyChecking=accept-new',
      'SendEnv CI GITHUB_*'
    ].join('\n')

    fs.appendFileSync(path.join(sshDirectory, 'config'), `${lines}\n`)
  }

  async convertToRawDisk(
    diskImage: fs.PathLike,
    resourcesDirectory: fs.PathLike
  ): Promise<void> {
    core.debug('Converting qcow2 image to raw')
    const resDir = resourcesDirectory.toString()
    await exec.exec(path.join(resDir, 'qemu-img'), [
      'convert',
      '-f',
      'qcow2',
      '-O',
      'raw',
      diskImage.toString(),
      path.join(resDir, this.targetDiskName)
    ])
  }
}

class ResourceDisk {
  private readonly mountName = 'RES'
  private readonly mountPath: string

  private readonly tempPath: string
  private readonly diskPath: string
  private devicePath!: string

  constructor(tempPath: string) {
    this.mountPath = path.join('/Volumes', this.mountName)
    this.tempPath = tempPath
    this.diskPath = path.join(this.tempPath, 'res.raw')
  }

  async create(): Promise<string> {
    core.debug('Creating resource disk')
    await this.createDiskFile()
    this.devicePath = await this.createDiskDevice()
    await this.partitionDisk()

    return this.mountPath
  }

  async unmount(): Promise<void> {
    await this.unmountDisk()
    await this.detachDisk()
  }

  private async createDiskFile(): Promise<void> {
    await exec.exec('mkfile', ['-n', '40m', this.diskPath])
  }

  private async createDiskDevice(): Promise<string> {
    const devicePath = await execWithOutput(
      'hdiutil',
      [
        'attach',
        '-imagekey',
        'diskimage-class=CRawDiskImage',
        '-nomount',
        this.diskPath
      ],
      {silent: true}
    )

    return devicePath.trim()
  }

  private async partitionDisk(): Promise<void> {
    await exec.exec('diskutil', [
      'partitionDisk',
      this.devicePath,
      '1',
      'GPT',
      'fat32',
      this.mountPath,
      '100%'
    ])
  }

  private async unmountDisk(): Promise<void> {
    await exec.exec('umount', [this.mountPath])
  }

  private async detachDisk(): Promise<void> {
    await exec.exec('hdiutil', ['detach', this.devicePath])
  }
}
