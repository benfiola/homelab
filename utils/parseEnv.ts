import { z } from "zod";

type Callback<Shape extends z.ZodRawShape> = (zod: typeof z) => Shape;

/**
 * Parses (and validates) data from the environment
 *
 * @param callback a function returning the data shape to validate
 * @returns validated data
 */
export const parseEnv = <Shape extends z.ZodRawShape>(
  callback: Callback<Shape>
): z.infer<z.ZodObject<Shape>> => {
  const shape = callback(z);
  const schema = z.object(shape);
  return schema.parse(process.env);
};
