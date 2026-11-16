local d = import 'dashboards/lib.libsonnet';

{
  dashboards: {
    'mediarr.json': d.dashboard('Mediarr', 'mediarr', [
      import 'dashboards/sonarr.libsonnet',
      import 'dashboards/radarr.libsonnet',
      import 'dashboards/seerr.libsonnet',
      import 'dashboards/jellyfin.libsonnet',
      import 'dashboards/prowlarr.libsonnet',
      import 'dashboards/sabnzbd.libsonnet',
      import 'dashboards/storage.libsonnet',
    ]),
  },
}
