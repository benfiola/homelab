import { Service, StatefulSet } from "../../../assets/kubernetes/k8s";
import {
  BucketServer,
  BucketSyncPolicy,
  Chart,
  GarageBucket,
  GarageKey,
  getSecurityContext,
  HttpRoute,
  Namespace,
  TcpRoute,
  VaultAuth,
  VaultStaticSecret,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, id) => {
  const chart = new Chart(construct, id, { namespace: id });

  new Namespace(chart);

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
      name: "minecraft-oigim8",
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

  new HttpRoute(chart, "trusted", "assets.minecraft.bulia.dev").match(
    bucketServerService,
    80,
  );

  const securityContext = getSecurityContext({ uid: 1000, gid: 1000 });

  new StatefulSet(chart, `${id}-stateful-set`, {
    metadata: {
      name: "minecraft",
    },
    spec: {
      selector: {
        matchLabels: {
          "app.kubernetes.io/name": "minecraft",
        },
      },
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/name": "minecraft",
          },
        },
        spec: {
          containers: [
            {
              name: "minecraft",
              image: "itzg/minecraft-server:java25-jdk",
              env: [
                { name: "EULA", value: "true" },
                { name: "VERSION", value: "1.21.11" },
              ],
              ports: [
                {
                  name: "game",
                  containerPort: 25565,
                },
              ],
              securityContext: securityContext.container,
            },
          ],
          securityContext: securityContext.pod,
        },
      },
    },
  });

  const service = new Service(chart, `${id}-service`, {
    metadata: {
      name: "minecraft",
    },
    spec: {
      selector: {
        "app.kubernetes.io/name": "minecraft",
      },
      ports: [
        {
          port: 25565,
          name: "game",
        },
      ],
    },
  });

  new TcpRoute(chart, "trusted", "minecraft.bulia.dev", 25565).match(
    service,
    25565,
  );

  new TcpRoute(chart, "public", "minecraft.bfiola.dev", 25565).match(
    service,
    25565,
  );

  return chart;
};
