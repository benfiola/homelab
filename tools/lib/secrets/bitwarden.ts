// the Bitwarden Secrets Manager organization, and the project its secrets are kept in. none of these
// is a credential: access is by machine account tokens
export const organization = "c07e92b8-0d2e-4b8a-a9ed-b4880124c6a0";
export const project = "5b43cd1a-4cb5-4ae7-936e-b488012786c2";

// the `apps` secret, by id: the machine account that external secrets reads with may read this one
// secret but not the project, and a secret looked up by name is found by listing the project
export const appsSecret = "ec62ad56-d707-4bde-a312-b4880129d86f";
