#!/usr/bin/env ruby

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
    system "ssh -i id_rsa root@#{ip_address} '#{command}'"
  end

  def run
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
    0.upto(19) do
      result = `arp -a -n`
        .split("\n")
        .find { |e| e.include?(mac_address) }

      match_result = /\((.+)\)/.match(result)
      return match_result[1] if match_result
      sleep 5
    end

    raise "Failed to get IP address for MAC address: #{mac_address}"
  end

  def get_ip_address_from_dhcpd_leases(mac_address)
    0.upto(9) do
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
      sleep 5
    end

    raise "Failed to get IP address for MAC address: #{mac_address}"
  end
end

class CiRunner
  def run
    config_ssh_allow_new_hosts
    puts vm.mac_address
    vm.run
    puts vm.ip_address
    vm.exec 'freebsd-version'
    vm.exec 'shutdown -p now'
  end

  def vm
    @vm ||= XhyveVm.new
  end

  def config_ssh_allow_new_hosts
    File.write(File.join(ENV['HOME'], '.ssh/config'), 'StrictHostKeyChecking=accept-new', mode: 'a')
  end
end

CiRunner.new.run
