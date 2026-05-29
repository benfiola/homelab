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

const guardedProxy = (obj: Record<string, any>, path: string): any =>
  new Proxy(obj, {
    get(target, key) {
      if (typeof key === "symbol") {
        return target[key as any];
      }
      const fullPath = path ? `${path}.${key}` : key;
      const value = target[key];
      if (value === undefined) {
        throw new Error(`Template accessed undefined field: ${fullPath}`);
      }
      if (value !== null && typeof value === "object") {
        return guardedProxy(value, fullPath);
      }
      return value;
    },
  });

export const renderTemplate = (template: string, data: Record<string, any>) => {
  const guarded = guardedProxy(data, "");
  const fn = new Function(...Object.keys(data), `return \`${template}\``);
  return fn(...Object.keys(data).map((k) => guarded[k]));
};
