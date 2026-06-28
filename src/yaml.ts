import {
  CreateNodeOptions,
  DocumentOptions,
  ParseOptions,
  SchemaOptions,
  ToStringOptions,
  stringify as yamlStringify,
} from "yaml";

type YamlOptions = DocumentOptions &
  SchemaOptions &
  ParseOptions &
  CreateNodeOptions &
  ToStringOptions;

export const options = (options: YamlOptions) => {
  return {
    __options: true,
    ...options,
  };
};

type Options = ReturnType<typeof options>;

type StringifyArg = Options | any;

export const stringify = (...records: StringifyArg[]) => {
  let options: YamlOptions = {};
  const recordsToStringify = records.filter((r) => {
    if (r.__options) {
      options = r;
      return false;
    }
    return true;
  });
  options.schema ??= "json";
  return recordsToStringify.map((r) => yamlStringify(r, options)).join("---\n");
};
