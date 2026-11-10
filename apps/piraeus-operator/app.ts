import type { AppFunction } from "../../tools/lib/app.ts";
import {
  component,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  // the overlay's own base already declares (and privileges) this namespace, renamed to the
  // app's by the namespace transform below: a Namespace of our own would conflict with it
  const ns = h.namespace({ external: true });
  await ns.kustomize(
    "github.com/piraeusdatastore/piraeus-operator/config/default?ref=v2.12.1",
    {
      labels: { "app.kubernetes.io/name": h.app },
    },
  );

  ns.vpa({ kind: "Deployment", name: "piraeus-operator-controller-manager" });
  ns.vpa({ kind: "Deployment", name: "piraeus-operator-gencert" });

  // no limits: the autoscaler sizes requests
  h.postRender((e) => {
    for (const [deployment, name] of [
      ["piraeus-operator-controller-manager", "manager"],
      ["piraeus-operator-gencert", "gencert"],
    ]) {
      const d = e.find({ kind: "Deployment", name: deployment });
      delete e.container(d, name).resources.limits;
    }
  });
};

export const network: NetworkFunction = (n) => {
  const linstorAffinityController = n.subject(
    "linstor-affinity-controller",
    component("linstor-affinity-controller", "piraeus-operator"),
  );
  const linstorController = n.subject(
    "linstor-controller",
    component("linstor-controller", "piraeus-operator"),
  );
  const linstorCsiController = n.subject(
    "linstor-csi-controller",
    component("linstor-csi-controller", "piraeus-operator"),
  );
  const linstorCsiNfsServer = n.subject(
    "linstor-csi-nfs-server",
    component("linstor-csi-nfs-server", "piraeus-operator"),
  );
  const linstorSatellite = n.subject(
    "linstor-satellite",
    component("linstor-satellite", "piraeus-operator"),
  );
  const piraeusOperator = n.subject(
    "piraeus-operator",
    component("piraeus-operator", "piraeus-operator"),
  );
  const piraeusOperatorGencert = n.subject(
    "piraeus-operator-gencert",
    component("piraeus-operator-gencert", "piraeus-operator"),
  );
  const piraeusOperatorHaController = n.subject(
    "piraeus-operator-ha-controller",
    component("ha-controller", "piraeus-operator"),
  );

  linstorAffinityController
    .to(n.kubeApiServer, tcp(6443))
    .to(linstorController, tcp(3370));
  n.host.to(linstorAffinityController, tcp(8000));

  linstorController
    .to(n.kubeApiServer, tcp(6443))
    .to(linstorSatellite, tcp(3366));
  n.nodes.to(linstorController, tcp(3370));

  linstorCsiController
    .to(n.kubeApiServer, tcp(6443))
    .to(linstorController, tcp(3370));
  n.host.to(linstorCsiController, tcp([9808, 9813]));

  linstorCsiNfsServer
    .to(n.kubeApiServer, tcp(6443))
    .to(linstorController, tcp(3370));
  n.nodes.to(linstorCsiNfsServer, tcp(1000));

  linstorSatellite.to(linstorSatellite, tcp([7000, 7999]));
  n.nodes.to(linstorSatellite, tcp(3366, 9942));

  piraeusOperator
    .to(n.kubeApiServer, tcp(6443))
    .to(linstorController, tcp(3370));
  n.controlPlane.to(piraeusOperator, tcp(9443));
  n.host.to(piraeusOperator, tcp(8081));

  piraeusOperatorGencert.to(n.kubeApiServer, tcp(6443));
  n.host.to(piraeusOperatorGencert, tcp(8081));

  piraeusOperatorHaController.to(n.kubeApiServer, tcp(6443));
  n.host.to(piraeusOperatorHaController, tcp(8000));
};
