# general settings
/ipv6/settings/set disable-ipv6=yes
/system/clock/set time-zone-name=America/Los_Angeles
/system/identity/set name=router

# create bridge interfaces
/interface/bridge/add name=bridge admin-mac=78:9A:18:16:98:00 auto-mac=no protocol-mode=none pvid=999 vlan-filtering=yes

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
/interface/wireguard/add name=wg-users listen-port=13231 mtu=1420 private-key="${secrets.wireguard.interfaces.users.private}"
/interface/wireguard/add name=wg-personal listen-port=13232 mtu=1420 private-key="${secrets.wireguard.interfaces.personal.private}"
/interface/wireguard/add name=wg-infrastructure listen-port=13233 mtu=1420 private-key="${secrets.wireguard.interfaces.infrastructure.private}"
/interface/wireguard/add name=wg-management listen-port=13234 mtu=1420 private-key="${secrets.wireguard.interfaces.management.private}"

# create wireguard peers
/interface/wireguard/peers/add allowed-address=192.168.9.2/32 interface=wg-users name=jfiola-iphone persistent-keepalive=25s public-key="${secrets.wireguard.devices.jfiolaIphone.users.public}"
/interface/wireguard/peers/add allowed-address=192.168.17.2/32 interface=wg-personal name=bfiola-home-laptop-personal persistent-keepalive=25s public-key="${secrets.wireguard.devices.bfiolaHomeLaptop.personal.public}"
/interface/wireguard/peers/add allowed-address=192.168.34.2/32 interface=wg-infrastructure name=bfiola-home-laptop-infrastructure persistent-keepalive=25s public-key="${secrets.wireguard.devices.bfiolaHomeLaptop.infrastructure.public}"
/interface/wireguard/peers/add allowed-address=192.168.89.2/32 interface=wg-management name=bfiola-home-laptop-management persistent-keepalive=25s public-key="${secrets.wireguard.devices.bfiolaHomeLaptop.management.public}"
/interface/wireguard/peers/add allowed-address=192.168.34.3/32 interface=wg-infrastructure name=bfiola-desktop-infrastructure persistent-keepalive=25s public-key="${secrets.wireguard.devices.bfiolaDesktop.infrastructure.public}"
/interface/wireguard/peers/add allowed-address=192.168.89.3/32 interface=wg-management name=bfiola-desktop-management persistent-keepalive=25s public-key="${secrets.wireguard.devices.bfiolaDesktop.management.public}"

# create vlan interfaces
/interface/vlan/add name=users interface=bridge vlan-id=8
/interface/vlan/add name=personal interface=bridge vlan-id=16
/interface/vlan/add name=iot interface=bridge vlan-id=24
/interface/vlan/add name=infrastructure interface=bridge vlan-id=32
/interface/vlan/add name=management interface=bridge vlan-id=88

# create interface lists
/interface/list/add name=USERS
/interface/list/member/add list=USERS interface=users
/interface/list/member/add list=USERS interface=wg-users
/interface/list/add name=PERSONAL
/interface/list/member/add list=PERSONAL interface=personal
/interface/list/member/add list=PERSONAL interface=wg-personal
/interface/list/add name=IOT
/interface/list/member/add list=IOT interface=iot
/interface/list/add name=INFRASTRUCTURE
/interface/list/member/add list=INFRASTRUCTURE interface=infrastructure
/interface/list/member/add list=INFRASTRUCTURE interface=wg-infrastructure
/interface/list/add name=MANAGEMENT
/interface/list/member/add list=MANAGEMENT interface=management
/interface/list/member/add list=MANAGEMENT interface=wg-management
/interface/list/add name=RESCUE
/interface/list/member/add list=RESCUE interface=ether10
/interface/list/add name=VLAN include=USERS,PERSONAL,IOT,INFRASTRUCTURE,MANAGEMENT
/interface/list/add name=WAN
/interface/list/member/add list=WAN interface=ether1

# define interface networks
/ip/address/add address=192.168.8.1/24 interface=users network=192.168.8.0
/ip/address/add address=192.168.9.1/24 interface=wg-users network=192.168.9.0
/ip/address/add address=192.168.16.1/24 interface=personal network=192.168.16.0
/ip/address/add address=192.168.17.1/24 interface=wg-personal network=192.168.17.0
/ip/address/add address=192.168.24.1/24 interface=iot network=192.168.24.0
/ip/address/add address=192.168.32.1/23 interface=infrastructure network=192.168.32.0
/ip/address/add address=192.168.34.1/24 interface=wg-infrastructure network=192.168.34.0
/ip/address/add address=192.168.88.1/24 interface=management network=192.168.88.0
/ip/address/add address=192.168.89.1/24 interface=wg-management network=192.168.89.0
/ip/address/add address=192.168.255.1/24 interface=ether10 network=192.168.255.0

# create ip pools
/ip/pool/add name=users ranges=192.168.8.2-192.168.8.254
/ip/pool/add name=personal ranges=192.168.16.2-192.168.16.254
/ip/pool/add name=iot ranges=192.168.24.2-192.168.24.254
/ip/pool/add name=infrastructure ranges=192.168.32.2-192.168.32.254
/ip/pool/add name=management ranges=192.168.88.2-192.168.88.254
/ip/pool/add name=rescue ranges=192.168.255.2-192.168.255.254

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
/ip/dhcp-client/add interface=ether1

# assign static ips
/ip/dhcp-server/lease/add address=192.168.24.2 server=iot mac-address=64:9A:63:A9:FC:54 comment="ring doorbell"
/ip/dhcp-server/lease/add address=192.168.24.3 server=iot mac-address=60:E8:5B:8C:49:CA comment="ring camera (front yard)"
/ip/dhcp-server/lease/add address=192.168.24.4 server=iot mac-address=34:08:E1:14:CF:4A comment="ring camera (garage)"
/ip/dhcp-server/lease/add address=192.168.24.5 server=iot mac-address=18:7F:88:13:CF:67 comment="ring chime (living room)"
/ip/dhcp-server/lease/add address=192.168.24.6 server=iot mac-address=EC:0D:E4:C3:92:9C comment="echo studio (bedroom 2)"
/ip/dhcp-server/lease/add address=192.168.32.2 server=infrastructure mac-address=DC:A6:32:E8:02:E2 comment="node-a.cluster"
/ip/dhcp-server/lease/add address=192.168.32.3 server=infrastructure mac-address=DC:A6:32:C1:49:6F comment="node-b.cluster"
/ip/dhcp-server/lease/add address=192.168.32.4 server=infrastructure mac-address=DC:A6:32:E8:02:B3 comment="node-c.cluster"
/ip/dhcp-server/lease/add address=192.168.32.5 server=infrastructure mac-address=38:F3:AB:E0:C5:DD comment="node-d.cluster"
/ip/dhcp-server/lease/add address=192.168.32.6 server=infrastructure mac-address=88:A4:C2:A0:B5:BB comment="node-e.cluster"
/ip/dhcp-server/lease/add address=192.168.32.7 server=infrastructure mac-address=F8:75:A4:FE:1F:E9 comment="node-f.cluster"
/ip/dhcp-server/lease/add address=192.168.32.8 server=infrastructure mac-address=00:2B:67:D6:40:6B comment="node-g.cluster"
/ip/dhcp-server/lease/add address=192.168.88.2 server=management mac-address=F4:1E:57:F8:8F:89 comment="core.switch"
/ip/dhcp-server/lease/add address=192.168.88.3 server=management mac-address=F4:1E:57:F8:96:77 comment="cluster.switch"
/ip/dhcp-server/lease/add address=192.168.88.4 server=management mac-address=94:83:C4:AB:04:1F comment="office.ap"
/ip/dhcp-server/lease/add address=192.168.88.5 server=management mac-address=94:83:C4:AB:06:68 comment="bedroom-2.ap"
/ip/dhcp-server/lease/add address=192.168.88.6 server=management mac-address=94:83:C4:AA:F9:1B comment="living-room.ap"

# assign dns
/ip/dns/static/add name=node-a.cluster.bulia.dev address=192.168.32.2 ttl=10m
/ip/dns/static/add name=node-b.cluster.bulia.dev address=192.168.32.3 ttl=10m
/ip/dns/static/add name=node-c.cluster.bulia.dev address=192.168.32.4 ttl=10m
/ip/dns/static/add name=node-d.cluster.bulia.dev address=192.168.32.5 ttl=10m
/ip/dns/static/add name=node-e.cluster.bulia.dev address=192.168.32.6 ttl=10m
/ip/dns/static/add name=node-f.cluster.bulia.dev address=192.168.32.7 ttl=10m
/ip/dns/static/add name=node-g.cluster.bulia.dev address=192.168.32.8 ttl=10m
/ip/dns/static/add name=cluster.bulia.dev cname=node-a.cluster.bulia.dev type=CNAME ttl=10m
/ip/dns/static/add name=core.switch.bulia.dev address=192.168.88.2 ttl=10m
/ip/dns/static/add name=cluster.switch.bulia.dev address=192.168.88.3 ttl=10m
/ip/dns/static/add name=office.ap.bulia.dev address=192.168.88.4 ttl=10m
/ip/dns/static/add name=living-room.ap.bulia.dev address=192.168.88.6 ttl=10m
/ip/dns/static/add name=bedroom-2.ap.bulia.dev address=192.168.88.5 ttl=10m

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
/ip/firewall/address-list/add list=IOT_ALLOW_WAN address=192.168.24.2 comment="ring doorbell"
/ip/firewall/address-list/add list=IOT_ALLOW_WAN address=192.168.24.3 comment="ring camera (front yard)"
/ip/firewall/address-list/add list=IOT_ALLOW_WAN address=192.168.24.4 comment="ring camera (garage)"
/ip/firewall/address-list/add list=IOT_ALLOW_WAN address=192.168.24.5 comment="ring chime (living room)"
/ip/firewall/address-list/add list=IOT_ALLOW_WAN address=192.168.24.6 comment="echo studio (bedroom 2)"
/ip/firewall/address-list/add list=INFRASTRUCTURE_INGRESS_USERS address=192.168.33.2/32 comment="cluster gateway (users)"
/ip/firewall/address-list/add list=INFRASTRUCTURE_INGRESS_PERSONAL address=192.168.33.3/32 comment="cluster gateway (personal)"

# configure firewall
/ip/firewall/filter/add chain=input action=accept connection-state=established,related comment="accept established,related"
/ip/firewall/filter/add chain=input action=drop connection-state=invalid comment="drop invalid"
/ip/firewall/filter/add chain=input action=accept dst-port=13231-13234 protocol=udp comment="accept wireguard"
/ip/firewall/filter/add chain=input action=accept in-interface-list=RESCUE comment="accept rescue"
/ip/firewall/filter/add chain=input action=accept in-interface-list=MANAGEMENT comment="accept management"
/ip/firewall/filter/add chain=input action=accept in-interface-list=VLAN dst-port=53,67 protocol=udp comment="accept vlan -> dns,dhcp"
/ip/firewall/filter/add chain=input action=passthrough comment=router-policy-sync::marker disabled=yes
/ip/firewall/filter/add chain=input action=drop comment="drop unaccepted"
/ip/firewall/filter/add chain=forward action=fasttrack connection-state=established,related comment="fasttrack established,related"
/ip/firewall/filter/add chain=forward action=accept connection-state=established,related comment="accept established,related"
/ip/firewall/filter/add chain=forward action=drop connection-state=invalid comment="drop invalid"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=RESCUE comment="accept rescue"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=INFRASTRUCTURE out-interface-list=INFRASTRUCTURE comment="accept infrastructure -> infrastructure"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=INFRASTRUCTURE out-interface-list=WAN comment="accept infrastructure -> wan"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=IOT out-interface-list=IOT comment="accept iot -> iot"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=IOT src-address-list=IOT_ALLOW_WAN out-interface-list=WAN comment="accept iot (allow wan) -> wan"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=MANAGEMENT out-interface-list=MANAGEMENT comment="accept management -> management"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=PERSONAL out-interface-list=PERSONAL comment="accept personal -> personal"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=PERSONAL out-interface-list=INFRASTRUCTURE dst-address-list=INFRASTRUCTURE_INGRESS_PERSONAL comment="accept personal -> infrastructure (personal ingress)"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=PERSONAL out-interface-list=INFRASTRUCTURE dst-address-list=INFRASTRUCTURE_INGRESS_USERS comment="accept personal -> infrastructure (users ingress)"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=PERSONAL out-interface-list=IOT comment="accept personal -> iot"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=PERSONAL out-interface-list=WAN comment="accept personal -> wan"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=USERS out-interface-list=USERS comment="accept users -> users"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=USERS out-interface-list=INFRASTRUCTURE dst-address-list=INFRASTRUCTURE_INGRESS_USERS comment="accept users -> infrastructure (users ingress)"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=USERS out-interface-list=IOT comment="accept users -> iot"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=USERS out-interface-list=WAN comment="accept users -> wan"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=WAN connection-nat-state=dstnat comment="accept dstnat wan"

/ip/firewall/filter/add chain=forward action=drop comment="drop unaccepted"
/ip/firewall/nat/add chain=srcnat action=masquerade comment=masquerade out-interface-list=WAN
