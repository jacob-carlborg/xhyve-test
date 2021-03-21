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

class XhyveVm
  def initialize
    mac_address # eagerly set MAC address
  end

  def ip_address
    @ip_address ||= get_ip_address(mac_address)
  end

  def exec(command)
    0.upto(20) do
      system "ssh -i id_rsa root@#{ip_address} '#{command}'"
      return if $?.success?
      sleep 1
    end

    raise "Failed to execute VM command: #{command}"
  end

  def run
    puts "run"
    fork { `./run.sh` }
  end

  def mac_address
    @mac_address ||= `./run.sh -M`.strip[5 .. -1]
  end

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
    # config_ssh
    # install_qemu_img
    convert_to_raw_disk
    # puts vm.mac_address
    # vm.run
    # puts vm.ip_address
    # vm.exec 'freebsd-version'
    # vm.exec 'shutdown -p now'
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

  def install_qemu_img
    puts "install_qemu_img"
    FileUtils.mkdir_p('/usr/local/opt/glib/lib')
    File.rename('libglib-2.0.0.dylib', '/usr/local/opt/glib/lib/libglib-2.0.0.dylib')

    FileUtils.mkdir_p('/usr/local/opt/gettext/lib')
    File.rename('libintl.8.dylib', '/usr/local/opt/gettext/lib/libintl.8.dylib')

    FileUtils.mkdir_p('/usr/local/opt/pcre/lib')
    File.rename('libpcre.1.dylib', '/usr/local/opt/pcre/lib/libpcre.1.dylib')
  end

  def convert_to_raw_disk
    puts 'convert_to_raw_disk'
    system './qemu-img', 'convert', '-f', 'qcow2', '-O', 'raw', 'disk.qcow2', 'disk.raw'
    #`./qemu-img convert -f qcow2 -O raw disk.qcow2 disk.raw`
    raise 'Failed to convert disk image to raw format' unless $?.success?
  end
end

CiRunner.new.run
