import {
  BucketServer,
  BucketSyncPolicy,
  Chart,
  GarageBucket,
  GarageKey,
  HttpRoute,
  VaultAuth,
  VaultStaticSecret,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  const auth = new VaultAuth(chart);

  const secret = new VaultStaticSecret(chart, auth);

  const key = new GarageKey(chart, "garage", id);
  const readKey = new GarageKey(chart, "garage", `${id}-read`);

  const bucket = new GarageBucket(chart, "garage", id, [key], {
    roKeys: [readKey],
  });

  new BucketSyncPolicy(
    chart,
    {
      name: "homelab-assets-698966",
      secret: secret.name,
      credentialsKey: "google-cloud-credentials-file",
    },
    {
      key,
      bucket,
    },
  );

  const bucketServer = new BucketServer(chart, bucket, readKey);

  new VerticalPodAutoscaler(chart, bucketServer);

  const bucketServerService = bucketServer.createService();

  new HttpRoute(chart, "trusted", "assets.bulia.dev").match(
    bucketServerService,
    80,
  );

  return chart;
};
