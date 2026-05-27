const trimTextblock = (block: string) => {
  let lines = block.split("\n");

  let whitespaceRegex = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") {
      continue;
    }
    if (whitespaceRegex === null) {
      const match = lines[i].match(new RegExp("^(\\s*)"));
      const whitespaceLength = match![1].length;
      whitespaceRegex = new RegExp(`^\\s{${whitespaceLength}}`);
    }
    lines[i] = lines[i].replace(whitespaceRegex, "");
  }

  return lines.join("\n").trim();
};

export const textblock = (parts: TemplateStringsArray, ...values: any[]) => {
  const data = String.raw({ raw: parts }, ...values);
  return trimTextblock(data);
};

const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";

export const randomString = async (length: number) => {
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
