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
