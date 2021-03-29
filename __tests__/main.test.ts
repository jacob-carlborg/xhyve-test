import * as main from '../src/main'

test('extractIpAddress - finding IP address', () => {
  const ipAddress = '192.168.0.2'
  const macAddress = '40:8e:71:34:88:eb'
  const arpOutput = [
    '? (0.0.0.0) at 00:00:00:00:00:00 on en2 ifscope [ethernet]',
    `? (${ipAddress}) at ${macAddress} on en1 ifscope [ethernet]`
  ].join('\n')
  const vm = new main.XhyveVm()

  expect(vm.extractIpAddress(arpOutput, macAddress)).toBe(ipAddress)
})

test('extractIpAddress - not finding IP address', () => {
  const macAddress = '40:8e:71:34:88:eb'
  const arpOutput = [
    '? (0.0.0.0) at 00:00:00:00:00:00 on en2 ifscope [ethernet]',
    '? (0.0.0.1) at 00:00:00:00:00:01 on en1 ifscope [ethernet]'
  ].join('\n')
  const vm = new main.XhyveVm()

  expect(vm.extractIpAddress(arpOutput, macAddress)).toBe(undefined)
})
