# general settings
/ipv6/settings/set disable-ipv6=yes
/system/clock/set time-zone-name=America/Los_Angeles
/system/identity/set name=router

# create bridge interfaces
/interface/bridge/add name=bridge admin-mac=78:9A:18:16:98:00 auto-mac=no protocol-mode=none pvid=8 vlan-filtering=yes

# configure vlan for bridge
/interface/bridge/vlan/add bridge=bridge tagged=bridge,sfp-sfpplus1 vlan-ids=8,16,24,32,88

# disabled unused interfaces
/interface/set [find name=ether2] disabled=yes
/interface/set [find name=ether3] disabled=yes
/interface/set [find name=ether4] disabled=yes
/interface/set [find name=ether5] disabled=yes
/interface/set [find name=ether6] disabled=yes
/interface/set [find name=ether7] disabled=yes
/interface/set [find name=ether8] disabled=yes
/interface/set [find name=ether9] disabled=yes

# add ports to bridges
/interface/bridge/port/add bridge=bridge interface=sfp-sfpplus1 frame-types=admit-only-vlan-tagged 

# create wireguard interfaces 
# /interface/wireguard/add name=wg-personal listen-port=13231 mtu=1420 private-key="${wireguardKey}"

# create wireguard peers
# /interface/wireguard/peers/add allowed-address=192.168.17.2/32 interface=wg-personal name=bfiola-iphone persistent-keepalive=25s public-key="QCU98RVjgQPLf37bMohtP4xfB339jAwoQMw7uH8WFws="
# /interface/wireguard/peers/add allowed-address=192.168.17.3/32 interface=wg-personal name=bfiola-work-laptop persistent-keepalive=25s public-key="ifWdY8DcGOpokludeMaUycJ0+pIN6LJs3qU9tnCjak8="
# /interface/wireguard/peers/add allowed-address=192.168.17.4/32 interface=wg-personal name=bfiola-home-laptop persistent-keepalive=25s public-key="wHy7pn0GmN5ytVTSWLoszycLMI1sCBm+nF9a/GtudUw="

# create vlan interfaces
/interface/vlan/add name=users interface=bridge vlan-id=8
/interface/vlan/add name=personal interface=bridge vlan-id=16
/interface/vlan/add name=iot interface=bridge vlan-id=24
/interface/vlan/add name=infrastructure interface=bridge vlan-id=32
/interface/vlan/add name=management interface=bridge vlan-id=88

# create interface lists
/interface/list/add name=USERS
/interface/list/member/add list=USERS interface=users
/interface/list/add name=PERSONAL
/interface/list/member/add list=PERSONAL interface=personal
# /interface/list/member/add list=PERSONAL interface=wg-personal
/interface/list/add name=IOT
/interface/list/member/add list=IOT interface=iot
/interface/list/add name=INFRASTRUCTURE
/interface/list/member/add list=INFRASTRUCTURE interface=infrastructure
/interface/list/add name=MANAGEMENT
/interface/list/member/add list=MANAGEMENT interface=management
/interface/list/add name=RESCUE
/interface/list/member/add list=RESCUE interface=ether10
/interface/list/add name=WAN
/interface/list/member/add list=WAN interface=ether1
/interface/list/add name=VLAN include=USERS,PERSONAL,IOT,INFRASTRUCTURE,MANAGEMENT

# define interface networks
/ip/address/add address=192.168.8.1/24 interface=users network=192.168.8.0
/ip/address/add address=192.168.16.1/24 interface=personal network=192.168.16.0
# /ip/address/add address=192.168.17.1/24 interface=wg-personal network=192.168.17.0
/ip/address/add address=192.168.24.1/24 interface=iot network=192.168.24.0
/ip/address/add address=192.168.32.1/23 interface=infrastructure network=192.168.32.0
/ip/address/add address=192.168.88.1/24 interface=management network=192.168.88.0
/ip/address/add address=192.168.255.1/24 interface=ether10 network=192.168.255.0

# create ip pools
/ip/pool/add name=users ranges=192.168.8.10-192.168.8.254
/ip/pool/add name=personal ranges=192.168.16.10-192.168.16.254
/ip/pool/add name=iot ranges=192.168.24.10-192.168.24.254
/ip/pool/add name=infrastructure ranges=192.168.32.10-192.168.32.254
/ip/pool/add name=management ranges=192.168.88.10-192.168.88.254
/ip/pool/add name=rescue ranges=192.168.255.10-192.168.255.254

# create dhcp servers
/ip/dhcp-server/add name=users address-pool=users interface=users lease-time=10m
/ip/dhcp-server/add name=personal address-pool=personal interface=personal lease-time=10m
/ip/dhcp-server/add name=iot address-pool=iot interface=iot lease-time=10m
/ip/dhcp-server/add name=infrastructure address-pool=infrastructure interface=infrastructure lease-time=10m
/ip/dhcp-server/add name=management address-pool=management interface=management lease-time=10m
/ip/dhcp-server/add name=rescue address-pool=rescue interface=ether10 lease-time=10m

# create dhcp server network
/ip/dhcp-server/network/add comment=users address=192.168.8.0/24 dns-server=192.168.88.1 gateway=192.168.8.1 netmask=24
/ip/dhcp-server/network/add comment=personal address=192.168.16.0/24 dns-server=192.168.88.1 gateway=192.168.16.1 netmask=24
/ip/dhcp-server/network/add comment=iot address=192.168.24.0/24 dns-server=192.168.88.1 gateway=192.168.24.1 netmask=24
/ip/dhcp-server/network/add comment=infrastructure address=192.168.32.0/23 dns-server=192.168.88.1 gateway=192.168.32.1 netmask=23
/ip/dhcp-server/network/add comment=management address=192.168.88.0/24 dns-server=192.168.88.1 gateway=192.168.88.1 netmask=24
/ip/dhcp-server/network/add comment=rescue address=192.168.255.0/24 dns-server=192.168.88.1 gateway=192.168.255.1 netmask=24

# create dhcp clients 
# NOTE: this appears to be automatically created
/ip/dhcp-client/add interface=ether1

# assign static ips
/ip/dhcp-server/lease/add address=192.168.24.10 server=iot mac-address=64:9A:63:A9:FC:54 comment="Ring (Front Door)"
/ip/dhcp-server/lease/add address=192.168.24.11 server=iot mac-address=60:E8:5B:8C:49:CA comment="Ring (Front Yard)"
/ip/dhcp-server/lease/add address=192.168.24.12 server=iot mac-address=34:08:E1:14:CF:4A comment="Ring (Garage)"
/ip/dhcp-server/lease/add address=192.168.24.13 server=iot mac-address=18:7F:88:13:CF:67 comment="Ring (Living Room)"
/ip/dhcp-server/lease/add address=192.168.24.14 server=iot mac-address=EC:0D:E4:C3:92:9C comment="Amazon Echo Studio (Bedroom 2)"

# assign dns
/ip/dns/static/add name=router.bulia.dev address=192.168.88.1 ttl=10m
/ip/dns/static/add name=core.switch.bulia.dev address=192.168.88.2 ttl=10m
/ip/dns/static/add name=cluster.switch.bulia.dev address=192.168.88.3 ttl=10m

# create bgp template
# NOTE: this appears to be automatically created
/routing/bgp/template/remove [find name=default]
/routing/bgp/template/add name=cluster afi=ip as=64512 disabled=no

# create bgp instance
/routing/bgp/instance/add name=cluster as=64512 disabled=no router-id=main

# create bgp connections
# /routing/bgp/connection/add name=node-b remote.address=192.168.32.14 afi=ip as=64512 disabled=no instance=cluster local.role=ibgp routing-table=main templates=cluster

# configure mdns repeater
/ip/dns/set allow-remote-requests=yes cache-max-ttl=1d mdns-repeat-ifaces=users,personal,iot

# configure firewall address lists
/ip/firewall/address-list/add list=IOT_WAN address=192.168.24.10 comment="Ring (Front Door)"
/ip/firewall/address-list/add list=IOT_WAN address=192.168.24.11 comment="Ring (Front Yard)"
/ip/firewall/address-list/add list=IOT_WAN address=192.168.24.12 comment="Ring (Garage)"
/ip/firewall/address-list/add list=IOT_WAN address=192.168.24.13 comment="Ring (Living Room)"
/ip/firewall/address-list/add list=IOT_WAN address=192.168.24.14 comment="Amazon Echo Studio (Bedroom 2)"

# configure firewall
/ip/firewall/filter/add chain=input action=accept connection-state=established,related comment="accept established,related"
/ip/firewall/filter/add chain=input action=drop connection-state=invalid comment="drop invalid"
/ip/firewall/filter/add chain=input action=accept in-interface-list=RESCUE comment="accept rescue"
/ip/firewall/filter/add chain=input action=accept in-interface-list=VLAN dst-port=53,67 protocol=udp comment="accept vlan (dns,dhcp)"
/ip/firewall/filter/add chain=input action=accept dst-port=13231 protocol=udp comment="accept wireguard"
/ip/firewall/filter/add chain=input action=passthrough comment=router-policy-sync::marker disabled=yes
/ip/firewall/filter/add chain=input action=drop comment="drop unaccepted"
/ip/firewall/filter/add chain=forward action=fasttrack connection-state=established,related comment="fasttrack established,related"
/ip/firewall/filter/add chain=forward action=accept connection-state=established,related comment="accept established,related"
/ip/firewall/filter/add chain=forward action=drop connection-state=invalid comment="drop invalid"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=RESCUE comment="accept rescue"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=INFRASTRUCTURE out-interface-list=WAN comment="accept infrastructure -> wan"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=IOT src-address-list=IOT_WAN out-interface-list=WAN comment="accept iot (with wan) -> wan"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=PERSONAL dst-address=192.168.33.10 out-interface-list=INFRASTRUCTURE comment="accept personal -> infrastructure (users gateway)"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=PERSONAL dst-address=192.168.33.11 out-interface-list=INFRASTRUCTURE comment="accept personal -> infrastructure (personal gateway)"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=PERSONAL out-interface-list=IOT comment="accept personal -> iot"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=PERSONAL out-interface-list=WAN comment="accept personal -> wan"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=USERS dst-address=192.168.33.10 out-interface-list=INFRASTRUCTURE comment="accept users -> infrastructure (users gateway)"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=USERS out-interface-list=IOT comment="accept users -> iot"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=USERS out-interface-list=WAN comment="accept users -> wan"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=WAN connection-nat-state=dstnat comment="accept dstnat wan"
/ip/firewall/filter/add chain=forward action=drop comment="drop unaccepted"
/ip/firewall/nat/add chain=srcnat action=masquerade comment=masquerade out-interface-list=WAN
