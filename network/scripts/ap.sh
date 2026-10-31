set -ex

# remove any defaults
while uci -q delete firewall.@forwarding[0]; do :; done
while uci -q delete firewall.@rule[0]; do :; done
while uci -q delete firewall.@zone[0]; do :; done
while uci -q delete network.@device[0]; do :; done
while uci -q delete network.@bridge-vlan[0]; do :; done
uci delete dhcp.lan || true
uci delete dhcp.wan || true
uci delete network.lan || true
uci delete network.wan || true
uci delete network.wan6 || true
uci delete wireless.default_radio0 || true
uci delete wireless.default_radio1 || true

uci batch <<EOF
# set general settings
set attendedsysupgrade.client.login_check_for_upgrades='0'
set system.@system[0].hostname='{{ device.name }}'
set system.@system[0].zonename='America/Los_Angeles'
set uhttpd.defaults.commonname='{{ device.name }}'

# configure network devices
add network device
set network.@device[-1]=device
set network.@device[-1].type='bridge'
set network.@device[-1].name='br-trunk'
add_list network.@device[-1].ports='eth1'
{{ ap.bridgeDevices }}
{{ ap.bridgeVlans }}

# create network interfaces
{{ ap.interfaces }}
set network.management=interface
set network.management.proto='dhcp'
set network.management.device='br-management'
set network.management.multipath='off'
set network.rescue=interface
set network.rescue.proto='static'
set network.rescue.device='lan5'
set network.rescue.ipaddr='192.168.255.1/24'
set network.rescue.multipath='off'

# create dhcp servers
set dhcp.rescue=dhcp
set dhcp.rescue.interface='rescue'
set dhcp.rescue.start='10'
set dhcp.rescue.limit='244'
set dhcp.rescue.leasetime='12h'
set dhcp.rescue.dhcpv4='server'
set dhcp.@dnsmasq[0].interface='rescue'

# configure firewalls
set firewall.@defaults[0].input='ACCEPT'
set firewall.@defaults[0].output='ACCEPT'
set firewall.@defaults[0].forward='ACCEPT'

# configure wireless radios
set wireless.radio0.country='US'
set wireless.radio0.channel='auto'
set wireless.radio0.htmode='HE20'
set wireless.radio0.cell_density='0'
set wireless.radio1.country='US'
set wireless.radio1.channel='auto'
set wireless.radio1.htmode='HE80'
set wireless.radio1.cell_density='0'

# create wireless networks
{{ ap.wireless }}

EOF

uci commit
