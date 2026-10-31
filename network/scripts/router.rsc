# general settings
/ipv6/settings/set disable-ipv6=yes
/system/clock/set time-zone-name=America/Los_Angeles
/system/identity/set name=router

# create user groups
/user/group/add name="api" policy=read,write,api,rest-api,!local,!telnet,!ssh,!ftp,!reboot,!policy,!test,!winbox,!password,!web,!sniff,!sensitive,!romon

# create users
/user/add name="external-dns" group="api" password="{{ secrets.router.users.externalDns }}"

# create bridge interfaces
/interface/bridge/add name=bridge admin-mac=78:9A:18:16:98:00 auto-mac=no protocol-mode=none pvid=999 vlan-filtering=yes

# configure vlan for bridge
/interface/bridge/vlan/add bridge=bridge tagged=bridge,sfp-sfpplus1 vlan-ids={{ router.vlanIds }}

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
{{ router.wireguardInterfaces }}

# create wireguard peers
{{ router.wireguardPeers }}

# create vlan interfaces
{{ router.vlanInterfaces }}

# create interface lists
{{ router.interfaceLists }}
/interface/list/add name=RESCUE
/interface/list/member/add list=RESCUE interface=ether10
/interface/list/add name=VLAN include={{ router.vlanLists }}
/interface/list/add name=WAN
/interface/list/member/add list=WAN interface=ether1

# define interface networks
{{ router.addresses }}
/ip/address/add address=192.168.255.1/24 interface=ether10 network=192.168.255.0

# create ip pools
{{ router.pools }}
/ip/pool/add name=rescue ranges=192.168.255.2-192.168.255.254

# create dhcp servers
{{ router.dhcpServers }}
/ip/dhcp-server/add name=rescue address-pool=rescue interface=ether10 lease-time=10m

# create dhcp server network
{{ router.dhcpNetworks }}
/ip/dhcp-server/network/add comment=rescue address=192.168.255.0/24 dns-server=192.168.88.1 gateway=192.168.255.1 netmask=24

# create dhcp clients 
/ip/dhcp-client/add interface=ether1

# assign static ips
{{ router.leases }}

# assign dns
{{ router.dns }}
/ip/dns/static/add name=cluster.{{ domain }} cname=samoyed.cluster.{{ domain }} type=CNAME ttl=10m

# create bgp template
# NOTE: this appears to be automatically created
/routing/bgp/template/remove [find name=default]
/routing/bgp/template/add name=cluster afi=ip as=64512 routing-table=main

# create bgp instance
/routing/bgp/instance/add name=cluster as=64512 router-id=main

# create bgp connections
{{ router.bgpConnections }}

# configure mdns repeater
/ip/dns/set allow-remote-requests=yes cache-max-ttl=1d mdns-repeat-ifaces=family,personal,infrastructure,iot

# configure firewall address lists
{{ router.allowLists }}
{{ router.ingressLists }}

# configure firewall
/ip/firewall/filter/add chain=input action=accept connection-state=established,related comment="accept established,related"
/ip/firewall/filter/add chain=input action=drop connection-state=invalid comment="drop invalid"
/ip/firewall/filter/add chain=input action=accept dst-port={{ router.wireguardPorts }} protocol=udp comment="accept wireguard"
/ip/firewall/filter/add chain=input action=accept in-interface-list=RESCUE comment="accept rescue"
/ip/firewall/filter/add chain=input action=accept in-interface-list=MANAGEMENT comment="accept management"
/ip/firewall/filter/add chain=input action=accept in-interface-list=VLAN dst-port=53,67,5353 protocol=udp comment="accept vlan -> dns,dhcp,mdns (udp)"
/ip/firewall/filter/add chain=input action=accept in-interface-list=VLAN dst-port=53 protocol=tcp comment="accept vlan -> dns (tcp)"
/ip/firewall/filter/add chain=input action=accept in-interface-list=INFRASTRUCTURE proto=tcp dst-port=80 comment="accept infrastructure -> http"
/ip/firewall/filter/add chain=input action=drop comment="drop unaccepted"
/ip/firewall/filter/add chain=forward action=fasttrack connection-state=established,related comment="fasttrack established,related"
/ip/firewall/filter/add chain=forward action=accept connection-state=established,related comment="accept established,related"
/ip/firewall/filter/add chain=forward action=drop connection-state=invalid comment="drop invalid"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=RESCUE comment="accept rescue"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=INFRASTRUCTURE out-interface-list=INFRASTRUCTURE comment="accept infrastructure -> infrastructure"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=INFRASTRUCTURE out-interface-list=INFRASTRUCTURE dst-address-list=INFRASTRUCTURE_INGRESS_INFRASTRUCTURE comment="accept infrastructure -> infrastructure (infrastructure ingress)"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=INFRASTRUCTURE out-interface-list=IOT comment="accept infrastructure -> iot"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=INFRASTRUCTURE src-address-list=INFRASTRUCTURE_ALLOW_WAN out-interface-list=WAN comment="accept infrastructure (allow wan) -> wan"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=IOT out-interface-list=IOT comment="accept iot -> iot"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=IOT src-address-list=IOT_ALLOW_WAN out-interface-list=WAN comment="accept iot (allow wan) -> wan"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=IOT src-address-list=IOT_ALLOW_INTRANET out-interface-list=FRIENDS comment="accept iot (allow intranet) -> friends"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=IOT src-address-list=IOT_ALLOW_INTRANET out-interface-list=FAMILY comment="accept iot (allow intranet) -> family"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=IOT src-address-list=IOT_ALLOW_INTRANET out-interface-list=INFRASTRUCTURE dst-address-list=INFRASTRUCTURE_INGRESS_FRIENDS comment="accept iot (allow intranet) -> infrastructure (friends ingress)"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=IOT src-address-list=IOT_ALLOW_INTRANET out-interface-list=INFRASTRUCTURE dst-address-list=INFRASTRUCTURE_INGRESS_FAMILY comment="accept iot (allow intranet) -> infrastructure (family ingress)"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=MANAGEMENT out-interface-list=MANAGEMENT comment="accept management -> management"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=PERSONAL out-interface-list=PERSONAL comment="accept personal -> personal"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=PERSONAL out-interface-list=INFRASTRUCTURE dst-address-list=INFRASTRUCTURE_INGRESS_PERSONAL comment="accept personal -> infrastructure (personal ingress)"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=PERSONAL out-interface-list=INFRASTRUCTURE dst-address-list=INFRASTRUCTURE_INGRESS_FAMILY comment="accept personal -> infrastructure (family ingress)"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=PERSONAL out-interface-list=INFRASTRUCTURE dst-address-list=INFRASTRUCTURE_INGRESS_FRIENDS comment="accept personal -> infrastructure (friends ingress)"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=PERSONAL out-interface-list=IOT comment="accept personal -> iot"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=PERSONAL out-interface-list=WAN comment="accept personal -> wan"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=FAMILY out-interface-list=FAMILY comment="accept family -> family"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=FAMILY out-interface-list=INFRASTRUCTURE dst-address-list=INFRASTRUCTURE_INGRESS_FAMILY comment="accept family -> infrastructure (family ingress)"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=FAMILY out-interface-list=INFRASTRUCTURE dst-address-list=INFRASTRUCTURE_INGRESS_FRIENDS comment="accept family -> infrastructure (friends ingress)"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=FAMILY out-interface-list=IOT comment="accept family -> iot"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=FAMILY out-interface-list=WAN comment="accept family -> wan"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=FRIENDS out-interface-list=FRIENDS comment="accept friends -> friends"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=FRIENDS out-interface-list=INFRASTRUCTURE dst-address-list=INFRASTRUCTURE_INGRESS_FRIENDS comment="accept friends -> infrastructure (friends ingress)"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=FRIENDS out-interface-list=WAN comment="accept friends -> wan"
/ip/firewall/filter/add chain=forward action=accept in-interface-list=WAN connection-nat-state=dstnat comment="accept dstnat wan"
/ip/firewall/filter/add chain=forward action=drop comment="drop unaccepted"
/ip/firewall/nat/add chain=srcnat action=masquerade comment=masquerade out-interface-list=WAN
