import * as fs from 'fs'
import * as path from 'path'

import * as cache from '@actions/tool-cache'
import * as core from '@actions/core'
import * as exec from '@actions/exec'

import * as xhyve from './xhyve_vm'
import {wait} from './wait'

export default class Action {
  private readonly resourceUrl =
    'https://github.com/jacob-carlborg/xhyve-test/releases/download/qcow2/resources.tar'

  private readonly targetDiskName = 'disk.raw'

  async run(): Promise<void> {
    core.debug('Running action')
    const resourcesArchivePath = await this.downloadResources()
    core.info(`Downloaded file: ${resourcesArchivePath}`)
    const resourcesDirectory = await this.unarchiveResoruces(
      resourcesArchivePath
    )
    const sshKeyPath = path.join(resourcesDirectory, 'id_ed25519')
    this.configSSH(sshKeyPath)

    await this.convertToRawDisk(resourcesDirectory)

    const VmClass = xhyve.Vm.getVm(xhyve.Type.freeBsd)
    const vm = new VmClass(sshKeyPath, path.join(resourcesDirectory, 'xhyve'), {
      memory: '4G',
      cpuCount: 2,
      diskImage: path.join(resourcesDirectory, this.targetDiskName),
      uuid: '864ED7F0-7876-4AA7-8511-816FABCFA87F',
      userboot: path.join(resourcesDirectory, 'userboot.so')
    })

    await vm.init()
    core.info('Booting VM')
    await vm.run()
    core.info('Waiting for VM to be ready')
    await wait(10_000)
    core.info('VM is ready')
    await vm.execute('freebsd-version')
    // "sh -c 'cd $GITHUB_WORKSPACE && exec sh'"
    await vm.stop()
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

  async convertToRawDisk(resourcesDirectory: fs.PathLike): Promise<void> {
    core.debug('Converting qcow2 image to raw')
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
