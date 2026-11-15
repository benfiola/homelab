local d = import 'lib.libsonnet';

d.dashboard('Prowlarr', 'mediarr-prowlarr', [
  [
    d.status('prowlarr'),
    d.stat('Indexers enabled', 'sum(prowlarr_indexer_enabled_total)', steps=[['red'], ['green', 1]], description='Indexers Prowlarr will search'),
    d.stat('Failed queries (24h)', 'sum(clamp_min(delta(prowlarr_failed_queries_by_indexer[1d]), 0)) or vector(0)', steps=d.ok),
    d.stat('Response time', 'max(prowlarr_response_time_by_indexer_milliseconds)', unit='ms', description='Slowest indexer'),
  ],
  [
    d.series('Queries per hour', { expr: 'clamp_min(delta(prowlarr_queries_by_indexer[1h]), 0)', legend: '{{indexer}}' }, min=0),
    d.series('Failed queries per hour', { expr: 'clamp_min(delta(prowlarr_failed_queries_by_indexer[1h]), 0)', legend: '{{indexer}}' }, min=0),
  ],
  [
    d.series('Response time', { expr: 'prowlarr_response_time_by_indexer_milliseconds', legend: '{{indexer}}' }, unit='ms', min=0),
    d.series('Queries by client', { expr: 'clamp_min(delta(prowlarr_queries_by_user_agent[1h]), 0)', legend: '{{user_agent}}' }, stack=true, min=0, description='Who is searching: sonarr, radarr'),
  ],
])
