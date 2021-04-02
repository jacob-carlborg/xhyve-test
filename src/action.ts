import * as fs from 'fs'
import * as path from 'path'

import * as cache from '@actions/tool-cache'
import * as core from '@actions/core'
import * as exec from '@actions/exec'

import * as xhyve from './xhyve_vm'

export default class Action {
  private readonly resourceUrl =
    'https://github.com/jacob-carlborg/xhyve-test/releases/download/qcow2/resources.tar'

  private readonly diskImageUrl =
    'https://github.com/jacob-carlborg/xhyve-test/releases/download/qcow2/disk.qcow2'

  private readonly targetDiskName = 'disk.raw'

  async run(): Promise<void> {
    core.debug('Running action')
    const [diskImagePath, resourcesArchivePath] = await Promise.all([
      this.downloadDiskImage(),
      this.downloadResources()
    ])
    const resourcesDirectory = await this.unarchiveResoruces(
      resourcesArchivePath
    )
    const sshKeyPath = path.join(resourcesDirectory, 'id_ed25519')
    this.configSSH(sshKeyPath)

    await this.convertToRawDisk(diskImagePath, resourcesDirectory)

    const VmClass = xhyve.Vm.getVm(xhyve.Type.freeBsd)
    const vm = new VmClass(sshKeyPath, path.join(resourcesDirectory, 'xhyve'), {
      memory: '4G',
      cpuCount: 2,
      diskImage: path.join(resourcesDirectory, this.targetDiskName),
      uuid: '864ED7F0-7876-4AA7-8511-816FABCFA87F',
      userboot: path.join(resourcesDirectory, 'userboot.so')
    })

    await vm.init()
    await vm.run()
    await vm.wait(10)
    await vm.execute('freebsd-version')
    // "sh -c 'cd $GITHUB_WORKSPACE && exec sh'"
    await vm.stop()
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

  async unarchiveResoruces(resourcesArchivePath: string): Promise<string> {
    core.info(`Unarchiving resoruces: ${resourcesArchivePath}`)
    return cache.extractTar(resourcesArchivePath, undefined, '-x')
  }

  configSSH(sshKey: fs.PathLike): void {
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
    fs.chmodSync(sshKey, 0o600)
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
