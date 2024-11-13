/**
 * Trims a multi-line codeblock.
 *
 * Removes leading and trailing whitespace.
 * Trims each line of whitespace equivalent to the first non-empty line.
 *
 */
const trimCodeBlock = (block: string) => {
  let lines = block.split("\n");

  let whitespaceRegex = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") {
      // ignore empty lines
      continue;
    }
    if (whitespaceRegex === null) {
      // determine leading whitespace of first non-empty line and build a replacement regex
      const match = lines[i].match(new RegExp("^(\\s*)"));
      const whitespaceLength = match![1].length;
      whitespaceRegex = new RegExp(`^\\s{${whitespaceLength}}`);
    }
    // remove leading whitespace of length equal to that of the first non-empty line
    lines[i] = lines[i].replace(whitespaceRegex, "");
  }

  return lines.join("\n").trim();
};

/**
 * Tagged string literal for a codeblock.
 *
 * Example usage:
 *
 * codeblock`
 *   console.log("this is a code block")
 *   if(true == false) {
 *     console.log("impossible!")
 *   }
 *   console.log("possible")
 * `
 *
 * @param parts
 * @param values
 * @returns
 */
export const codeblock = (parts: TemplateStringsArray, ...values: any[]) => {
  const data = String.raw({ raw: parts }, ...values);
  return trimCodeBlock(data);
};
