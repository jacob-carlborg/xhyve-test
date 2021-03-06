#!/usr/bin/env ruby

require 'fileutils'

class Object
  def try
    yield self
  end
end

class NilClass
  def try
  end
end

def try(default)
  yield
rescue Errno::ENOENT
  return default
end

def execute(*args)
  system(*args)
  raise "Failed to execute command: #{args.join(' ')}" unless $?.success?
end

class XhyveVm
  def initialize
    mac_address # eagerly set MAC address
  end

  def ip_address
    @ip_address ||= get_ip_address(mac_address)
  end

  def mac_address
    @mac_address ||= `./run.sh -M`.strip[5 .. -1]
  end

  def run
    @vm_pid = fork { `./run.sh` }
  end

  def stop
    execute 'shutdown -p now'
    Process.wait(vm_pid)
  end

  def execute(command)
    0.upto(20) do
      system 'ssh', '-i', 'id_ed25519', "root@#{ip_address}", command
      # system "ssh -i id_ed25519 root@#{ip_address} '#{command}'"
      return if $?.success?
      sleep 1
    end

    raise "Failed to execute VM command: #{command}"
  end

  private

  attr_reader :vm_pid

  def dhcpd_leases
    @dhcpd_leases ||= File.read('/var/db/dhcpd_leases')
  end

  def get_ip_address(mac_address)
    get_ip_address_from_arp(mac_address)
  end

  def get_ip_address_from_arp(mac_address)
    0.upto(100) do
      result = `arp -a -n`
        .split("\n")
        .find { |e| e.include?(mac_address) }

      match_result = /\((.+)\)/.match(result)
      return match_result[1] if match_result
      sleep 1
    end

    raise "Failed to get IP address for MAC address: #{mac_address}"
  end

  def get_ip_address_from_dhcpd_leases(mac_address)
    0.upto(50) do
      ip_address = try('') { dhcpd_leases }
        .split('{')
        .find { |e| e.include?(mac_address) }
        .try do |e|
          e.split("\n")
            .map(&:strip)
            .find { |e| e.start_with?("ip_address=") }
            .split('=')[1]
        end

      return ip_address if ip_address
      sleep 1
    end

    raise "Failed to get IP address for MAC address: #{mac_address}"
  end
end

class CiRunner
  def run
    config_ssh
    convert_to_raw_disk
    puts vm.mac_address
    vm.run
    puts vm.ip_address
    vm.execute 'freebsd-version'
    vm.stop
  end

  def vm
    @vm ||= XhyveVm.new
  end

  def ssh_directory
    @ssh_directory ||= File.join(ENV['HOME'], '.ssh')
  end

  def ssh_config_path
    @ssh_config_path ||= File.join(ssh_directory, 'config')
  end

  def config_ssh
    puts "config_ssh"
    File.write(ssh_config_path, 'StrictHostKeyChecking=accept-new', mode: 'a')
    File.chmod(0600, 'id_ed25519')
    File.chmod(0700, ssh_directory)
  end

  def convert_to_raw_disk
    puts 'convert_to_raw_disk'
    execute './qemu-img', 'convert', '-f', 'qcow2', '-O', 'raw', 'disk.qcow2', 'disk.raw'
  end
end

CiRunner.new.run
