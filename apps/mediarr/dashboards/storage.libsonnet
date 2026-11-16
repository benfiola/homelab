local d = import 'lib.libsonnet';

local claim = '{exported_namespace="mediarr", persistentvolumeclaim="media"}';
local used = 'max(kubelet_volume_stats_used_bytes%s)' % claim;
local free = 'max(kubelet_volume_stats_available_bytes%s)' % claim;
local tv = 'sum(sonarr_disk_size)';
local movies = 'sum(radarr_disk_size)';

d.section('Storage', [
  [
    d.stat('Used', used, unit='bytes', description='What the media share holds'),
    d.stat('TV', tv, unit='bytes', description='Sonarr\'s library'),
    d.stat('Movies', movies, unit='bytes', description='Radarr\'s library'),
    d.stat('Free', free, unit='bytes', steps=[['red'], ['orange', 1e12], ['green', 3e12]], description='The share has no quota, so this is the free space of the whole pool, shared with the other shares. The storage alerts fire at 3TB and 1TB'),
  ],
  [
    d.series('Used', [
      { expr: used, legend: 'share' },
      { expr: tv, legend: 'tv' },
      { expr: movies, legend: 'movies' },
    ], unit='bytes', min=0, description='Sonarr and radarr account for what the share holds; a gap between them and the share is something else on it, such as downloads in progress'),
    d.series('Free', free, unit='bytes', min=0, description='Free space of the whole pool'),
  ],
])
