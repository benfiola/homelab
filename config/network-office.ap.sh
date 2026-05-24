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

uci batch <<EOF
# set general settings
set system.@system[0].hostname='office.ap.bulia'
set system.@system[0].zonename='America/Los_Angeles'
set uhttpd.defaults.commonname='office.ap.bulia'

# create dhcp servers
set dhcp.rescue=dhcp
set dhcp.rescue.interface='rescue'
set dhcp.rescue.start='10'
set dhcp.rescue.limit='245'
set dhcp.rescue.leasetime='12h'

# configure firewalls
set firewall.@defaults[0].input='ACCEPT'
set firewall.@defaults[0].output='ACCEPT'
set firewall.@defaults[0].forward='ACCEPT'

# configure network devices
add network device
set network.@device[-1]=device
set network.@device[-1].type='bridge'
set network.@device[-1].name='br-trunk'
add_list network.@device[-1].ports='eth1'
add network device
set network.@device[-1]=device
set network.@device[-1].type='bridge'
set network.@device[-1].name='br-users'
set network.@device[-1].ports='br-trunk.8'
add network device
set network.@device[-1]=device
set network.@device[-1].type='bridge'
set network.@device[-1].name='br-iot'
set network.@device[-1].ports='br-trunk.24'
add network device
set network.@device[-1]=device
set network.@device[-1].type='bridge'
set network.@device[-1].name='br-management'
set network.@device[-1].ports='br-trunk.88'
add network bridge-vlan
set network.@bridge-vlan[-1]=bridge-vlan
set network.@bridge-vlan[-1].device='br-trunk'
set network.@bridge-vlan[-1].vlan='8'
add_list network.@bridge-vlan[-1].ports='eth1:t'
add network bridge-vlan
set network.@bridge-vlan[-1]=bridge-vlan
set network.@bridge-vlan[-1].device='br-trunk'
set network.@bridge-vlan[-1].vlan='16'
add_list network.@bridge-vlan[-1].ports='eth1:t'
add network bridge-vlan
set network.@bridge-vlan[-1]=bridge-vlan
set network.@bridge-vlan[-1].device='br-trunk'
set network.@bridge-vlan[-1].vlan='24'
add_list network.@bridge-vlan[-1].ports='eth1:t'
add network bridge-vlan
set network.@bridge-vlan[-1]=bridge-vlan
set network.@bridge-vlan[-1].device='br-trunk'
set network.@bridge-vlan[-1].vlan='88'
add_list network.@bridge-vlan[-1].ports='eth1:t'

# create network interfaces
set network.users=interface
set network.users.proto='none'
set network.users.device='br-users'
set network.iot=interface
set network.iot.proto='none'
set network.iot.device='br-iot'
set network.management=interface
set network.management.proto='dhcp'
set network.management.device='br-management'
set network.rescue=interface
set network.rescue.proto='static'
set network.rescue.device='lan5'
set network.rescue.ipaddr='192.168.255.1'
set network.rescue.netmask='255.255.255.0'

# configure wireless radios
set wireless.radio0.country='US'
set wireless.radio0.channel='auto'
set wireless.radio0.htmode='HE20'
set wireless.radio1.country='US'
set wireless.radio0.channel='auto'
set wireless.radio0.htmode='HE80'

# create wireless networks
set wireless.iot2g=wifi-iface
set wireless.iot2g.device='radio0'
set wireless.iot2g.mode='ap'
set wireless.iot2g.ssid='wifiwifiwifiwifi-iot'
set wireless.iot2g.encryption='psk-mixed'
set wireless.iot2g.key='${wifi.iot.key}'
set wireless.iot2g.ieee80211r='1'
set wireless.iot2g.ft_over_ds='0'
set wireless.iot2g.network='iot'
set wireless.iot2g.ft_psk_generate_local='1'
set wireless.iot2g.reassociation_deadline='20000'
set wireless.iot5g=wifi-iface
set wireless.iot5g.device='radio1'
set wireless.iot5g.mode='ap'
set wireless.iot5g.ssid='wifiwifiwifiwifi-iot'
set wireless.iot5g.encryption='psk-mixed'
set wireless.iot5g.key='${wifi.iot.key}'
set wireless.iot5g.ieee80211r='1'
set wireless.iot5g.ft_over_ds='0'
set wireless.iot5g.network='iot'
set wireless.iot5g.ft_psk_generate_local='1'
set wireless.iot5g.reassociation_deadline='20000'
set wireless.users2g=wifi-iface
set wireless.users2g.device='radio0'
set wireless.users2g.mode='ap'
set wireless.users2g.ssid='wifiwifiwifiwifi'
set wireless.users2g.encryption='sae-mixed'
set wireless.users2g.key='${wifi.users.key}'
set wireless.users2g.ieee80211r='1'
set wireless.users2g.ft_over_ds='0'
set wireless.users2g.ocv='0'
set wireless.users2g.network='users'
set wireless.users2g.reassociation_deadline='20000'
set wireless.users5g=wifi-iface
set wireless.users5g.device='radio1'
set wireless.users5g.mode='ap'
set wireless.users5g.ssid='wifiwifiwifiwifi'
set wireless.users5g.encryption='sae-mixed'
set wireless.users5g.key='${wifi.users.key}'
set wireless.users5g.ieee80211r='1'
set wireless.users5g.ft_over_ds='0'
set wireless.users5g.ocv='0'
set wireless.users5g.network='users'
set wireless.users5g.reassociation_deadline='20000'

EOF

uci commit
