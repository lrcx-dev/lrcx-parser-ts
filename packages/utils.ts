export const is_Function = (obj: unknown): obj is Function =>
  typeof obj === "function";

export const is_PlainObject = (obj: unknown): obj is Record<string, unknown> =>
  Object.prototype.toString.call(obj) === "[object Object]";

export const is_Defined = <T = unknown>(val: T): val is T =>
  val !== undefined && val !== null;

export const is_Object = (obj: unknown): obj is object =>
  typeof obj === "object" && obj !== null;

export const pierceGet = (
  source: Record<string, any>,
  objPath: string[],
): unknown => {
  let interim: any = source;
  for (const item of objPath) {
    interim = interim?.[item];
    if (interim === undefined) {
      return undefined;
    }
  }
  return interim;
};

export const pierceSet = (
  source: Record<string, any>,
  objPath: string[],
  value: unknown | ((target: Record<string, any>, key: string) => void),
): boolean => {
  let interim: Record<string, any> = source;

  for (let index = 0; index < objPath.length - 1; index += 1) {
    const item = objPath[index];
    const current = interim[item];
    if (is_Defined(current)) {
      if (!is_Object(current)) {
        return false;
      }
      interim = current as Record<string, any>;
      continue;
    }
    interim[item] = {};
    interim = interim[item] as Record<string, any>;
  }

  const lastKey = objPath[objPath.length - 1];
  if (is_Function(value)) {
    value(interim, lastKey);
  } else {
    interim[lastKey] = value;
  }
  return true;
};
