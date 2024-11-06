/**
 * Returns the annotation that instructs external-dns to create a DNS record
 * for the annotated resource
 *
 * @param dns the dns name
 * @returns dictionary
 */
export const getDnsAnnotation = (dns: string) => {
  return {
    "external-dns.alpha.kubernetes.io/hostname": dns,
  };
};
