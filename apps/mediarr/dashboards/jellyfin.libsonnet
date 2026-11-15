local d = import 'lib.libsonnet';

d.section('Jellyfin', [
  [
    d.status('jellyfin'),
    d.stat('Active streams', 'sum(jellyfin_sessions_total)', description='Sessions active in the last few minutes'),
    d.stat('Movies', 'sum(jellyfin_number_of_movies)'),
    d.stat('Series', 'sum(jellyfin_number_of_series)'),
    d.stat('Users', 'sum(jellyfin_number_of_users)'),
    d.stat('Devices', 'sum(jellyfin_number_of_devices)'),
    d.stat('Update', 'max(jellyfin_has_update)', steps=d.ok, mappings=[[0, 'Up to date', 'green'], [1, 'Available', 'orange']]),
  ],
  [
    d.series('Active streams', 'sum(jellyfin_sessions_total)', min=0),
    d.series('Library size', [
      { expr: 'sum(jellyfin_number_of_movies)', legend: 'movies' },
      { expr: 'sum(jellyfin_number_of_series)', legend: 'series' },
    ], min=0),
  ],
])
