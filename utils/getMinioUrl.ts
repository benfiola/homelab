/**
 * Gets the (internal) MinIO URL to the given path
 *
 * @param path bucket path
 * @returns the URL
 */
export const getMinioUrl = (path: string) => {
  if (path.startsWith("/")) {
    throw new Error(`path ${path} not relative`);
  }
  return `http://minio.minio.svc/${path}`;
};
