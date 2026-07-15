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
set system.@system[0].hostname='${inputs.hostname}'
set system.@system[0].zonename='America/Los_Angeles'
set uhttpd.defaults.commonname='${inputs.hostname}'

# configure network devices
add network device
set network.@device[-1]=device
set network.@device[-1].type='bridge'
set network.@device[-1].name='br-trunk'
add_list network.@device[-1].ports='eth1'
add network device
set network.@device[-1]=device
set network.@device[-1].type='bridge'
set network.@device[-1].name='br-family'
set network.@device[-1].ports='br-trunk.8'
add network device
set network.@device[-1]=device
set network.@device[-1].type='bridge'
set network.@device[-1].name='br-personal'
set network.@device[-1].ports='br-trunk.16'
add network device
set network.@device[-1]=device
set network.@device[-1].type='bridge'
set network.@device[-1].name='br-iot'
set network.@device[-1].ports='br-trunk.24'
add network device
set network.@device[-1]=device
set network.@device[-1].type='bridge'
set network.@device[-1].name='br-friends'
set network.@device[-1].ports='br-trunk.40'
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
set network.@bridge-vlan[-1].vlan='40'
add_list network.@bridge-vlan[-1].ports='eth1:t'
add network bridge-vlan
set network.@bridge-vlan[-1]=bridge-vlan
set network.@bridge-vlan[-1].device='br-trunk'
set network.@bridge-vlan[-1].vlan='88'
add_list network.@bridge-vlan[-1].ports='eth1:t'

# create network interfaces
set network.family=interface
set network.family.proto='none'
set network.family.device='br-family'
set network.family.multipath='off'
set network.friends=interface
set network.friends.proto='none'
set network.friends.device='br-friends'
set network.friends.multipath='off'
set network.personal=interface
set network.personal.proto='none'
set network.personal.device='br-personal'
set network.personal.multipath='off'
set network.iot=interface
set network.iot.proto='none'
set network.iot.device='br-iot'
set network.iot.multipath='off'
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
set wireless.iot2g=wifi-iface
set wireless.iot2g.device='radio0'
set wireless.iot2g.mode='ap'
set wireless.iot2g.ssid='wifiwifiwifiwifi-iot'
set wireless.iot2g.encryption='psk-mixed'
set wireless.iot2g.key='${secrets.wifi.iot}'
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
set wireless.iot5g.key='${secrets.wifi.iot}'
set wireless.iot5g.ieee80211r='1'
set wireless.iot5g.ft_over_ds='0'
set wireless.iot5g.network='iot'
set wireless.iot5g.ft_psk_generate_local='1'
set wireless.iot5g.reassociation_deadline='20000'
set wireless.personal2g=wifi-iface
set wireless.personal2g.device='radio0'
set wireless.personal2g.mode='ap'
set wireless.personal2g.ssid='wifiwifiwifiwifi-personal'
set wireless.personal2g.encryption='sae-mixed'
set wireless.personal2g.key='${secrets.wifi.personal}'
set wireless.personal2g.ieee80211r='1'
set wireless.personal2g.ft_over_ds='0'
set wireless.personal2g.ocv='0'
set wireless.personal2g.network='personal'
set wireless.personal2g.reassociation_deadline='20000'
set wireless.personal2g.hidden='1'
set wireless.personal5g=wifi-iface
set wireless.personal5g.device='radio1'
set wireless.personal5g.mode='ap'
set wireless.personal5g.ssid='wifiwifiwifiwifi-personal'
set wireless.personal5g.encryption='sae-mixed'
set wireless.personal5g.key='${secrets.wifi.personal}'
set wireless.personal5g.ieee80211r='1'
set wireless.personal5g.ft_over_ds='0'
set wireless.personal5g.ocv='0'
set wireless.personal5g.network='personal'
set wireless.personal5g.reassociation_deadline='20000'
set wireless.personal5g.hidden='1'
set wireless.family2g=wifi-iface
set wireless.family2g.device='radio0'
set wireless.family2g.mode='ap'
set wireless.family2g.ssid='wifiwifiwifiwifi-family'
set wireless.family2g.encryption='sae-mixed'
set wireless.family2g.key='${secrets.wifi.family}'
set wireless.family2g.ieee80211r='1'
set wireless.family2g.ft_over_ds='0'
set wireless.family2g.ocv='0'
set wireless.family2g.network='family'
set wireless.family2g.reassociation_deadline='20000'
set wireless.family5g=wifi-iface
set wireless.family5g.device='radio1'
set wireless.family5g.mode='ap'
set wireless.family5g.ssid='wifiwifiwifiwifi-family'
set wireless.family5g.encryption='sae-mixed'
set wireless.family5g.key='${secrets.wifi.family}'
set wireless.family5g.ieee80211r='1'
set wireless.family5g.ft_over_ds='0'
set wireless.family5g.ocv='0'
set wireless.family5g.network='family'
set wireless.family5g.reassociation_deadline='20000'
set wireless.friends2g=wifi-iface
set wireless.friends2g.device='radio0'
set wireless.friends2g.mode='ap'
set wireless.friends2g.ssid='wifiwifiwifiwifi'
set wireless.friends2g.encryption='sae-mixed'
set wireless.friends2g.key='${secrets.wifi.friends}'
set wireless.friends2g.ieee80211r='1'
set wireless.friends2g.ft_over_ds='0'
set wireless.friends2g.ocv='0'
set wireless.friends2g.network='friends'
set wireless.friends2g.reassociation_deadline='20000'
set wireless.friends5g=wifi-iface
set wireless.friends5g.device='radio1'
set wireless.friends5g.mode='ap'
set wireless.friends5g.ssid='wifiwifiwifiwifi'
set wireless.friends5g.encryption='sae-mixed'
set wireless.friends5g.key='${secrets.wifi.friends}'
set wireless.friends5g.ieee80211r='1'
set wireless.friends5g.ft_over_ds='0'
set wireless.friends5g.ocv='0'
set wireless.friends5g.network='friends'
set wireless.friends5g.reassociation_deadline='20000'

EOF

uci commit
