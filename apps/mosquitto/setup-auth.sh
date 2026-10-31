#!/bin/sh
set -e
touch /auth/password_file
chmod 0700 /auth/password_file
/usr/bin/mosquitto_passwd -b /auth/password_file home-assistant "${PASSWORD_HOME_ASSISTANT}"
/usr/bin/mosquitto_passwd -b /auth/password_file frigate "${PASSWORD_FRIGATE}"
