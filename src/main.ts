import { on, showUI } from "@create-figma-plugin/utilities";

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.round(n * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

interface VariableResult {
  name: string;
  collection: string;
  type: string;
  value: string;
  isAlias: boolean;
  aliasName: string | null;
}

async function resolveValue(
  variable: Variable,
  modeId: string
): Promise<{ value: string; isAlias: boolean; aliasName: string | null }> {
  const rawValue = variable.valuesByMode[modeId];

  // Check if value is an alias (reference to another variable)
  if (
    typeof rawValue === "object" &&
    rawValue !== null &&
    "type" in rawValue &&
    (rawValue as { type: string }).type === "VARIABLE_ALIAS"
  ) {
    const alias = rawValue as { type: string; id: string };
    const referenced = await figma.variables.getVariableByIdAsync(alias.id);
    if (referenced) {
      return {
        value: referenced.name,
        isAlias: true,
        aliasName: referenced.name,
      };
    }
    return { value: alias.id, isAlias: true, aliasName: null };
  }

  // Resolve actual value
  if (variable.resolvedType === "COLOR") {
    const c = rawValue as { r: number; g: number; b: number; a: number };
    return { value: rgbToHex(c.r, c.g, c.b), isAlias: false, aliasName: null };
  }

  return { value: String(rawValue), isAlias: false, aliasName: null };
}

export default function bootstrap() {
  showUI({
    height: 600,
    width: 420,
  });

  on("GET_VARIABLES", async () => {
    const collections =
      await figma.variables.getLocalVariableCollectionsAsync();
    const result: VariableResult[] = [];

    for (const collection of collections) {
      const modeId = collection.defaultModeId;

      for (const variableId of collection.variableIds) {
        const variable =
          await figma.variables.getVariableByIdAsync(variableId);
        if (!variable) continue;

        const resolved = await resolveValue(variable, modeId);

        result.push({
          name: variable.name,
          collection: collection.name,
          type: variable.resolvedType,
          value: resolved.value,
          isAlias: resolved.isAlias,
          aliasName: resolved.aliasName,
        });
      }
    }

    figma.ui.postMessage({ type: "VARIABLES_RESULT", data: result });
  });
}
