local d = import '../../tools/lib/k8s/dashboard.libsonnet';

local claim = '{exported_namespace="frigate", persistentvolumeclaim="nvr"}';
local used = 'max(kubelet_volume_stats_used_bytes%s)' % claim;
local free = 'max(kubelet_volume_stats_available_bytes%s)' % claim;

{
  dashboards: {
    'frigate.json': d.dashboard('Frigate', 'frigate', [
      d.section('Cameras', [
        [
          d.stat(
            'Status',
            'max(up{job="frigate/frigate"}) or vector(0)',
            steps=[['red'], ['green', 1]],
            mappings=[[0, 'Down', 'red'], [1, 'Up', 'green']],
            description='Whether prometheus could scrape frigate on its last attempt',
          ),
          d.stat('Cameras', 'count(frigate_camera_fps)'),
          d.stat('Cameras without frames', 'count(frigate_camera_fps == 0) or vector(0)', steps=d.bad, description='Cameras whose stream is down'),
          d.stat('Detector', 'max(frigate_detector_inference_speed_seconds)', unit='s', description='Average inference time of the slowest detector'),
          d.stat('GPU', 'max(frigate_gpu_usage_percent)', unit='percent', decimals=0),
        ],
        [
          d.series('Frames per second', { expr: 'frigate_camera_fps', legend: '{{camera_name}}' }, min=0, description='What each camera is sending. Zero means the stream is down'),
          d.series('Detections per second', [
            { expr: 'frigate_detection_fps', legend: '{{camera_name}}' },
          ], min=0, description='Frames run through the detector'),
        ],
        [
          d.series('Skipped frames per second', { expr: 'frigate_skipped_fps', legend: '{{camera_name}}' }, min=0, description='Frames dropped because the detector was busy'),
          d.series('Detector inference time', { expr: 'frigate_detector_inference_speed_seconds', legend: '{{name}}' }, unit='s', min=0),
        ],
        [
          d.series('Events per hour', { expr: 'sum by (camera, label) (increase(frigate_camera_events_total[1h]))', legend: '{{camera}} {{label}}' }, stack=true, min=0),
        ],
      ]),
      d.section('Storage', [
        [
          d.stat('Used', used, unit='bytes', description='What the nvr share holds, almost all of it recordings'),
          d.stat('Free', free, unit='bytes', steps=[['red'], ['orange', 1e12], ['green', 3e12]], description='The share has no quota, so this is the free space of the whole pool, shared with the other shares. The storage alerts fire at 3TB and 1TB'),
        ],
        [
          d.series('Used', used, unit='bytes', min=0, description='Frigate only reports storage by path, not by camera'),
          d.series('Free', free, unit='bytes', min=0, description='Free space of the whole pool'),
        ],
      ]),
    ], tags=['frigate'], from='now-7d'),
  },
}
