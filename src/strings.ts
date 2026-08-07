import nunjucks from "nunjucks";

export { dedent as textblock } from "ts-dedent";

const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";

export const randomString = (length: number) => {
  const randomNumbers = new Uint8Array(length);
  crypto.getRandomValues(randomNumbers);

  let result = "";
  for (let randomNumber of randomNumbers) {
    const index = randomNumber % alphabet.length;
    const char = alphabet[index];
    result += char;
  }

  return result;
};

// no filesystem loader - templates always come in as strings
const env = new nunjucks.Environment(null, {
  autoescape: false,
  throwOnUndefined: true,
});

export const renderTemplate = (template: string, data: Record<string, any>) =>
  env.renderString(template, data);
